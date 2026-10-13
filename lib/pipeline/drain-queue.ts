/**
 * A worker pool over a queue that can GROW while it runs.
 *
 * WHY THIS REPLACES "TAKE 32, RUN THEM, WAIT, TAKE 32 MORE".
 *
 * The orchestrator used to pull a batch off its buffer, run the pool over it,
 * and only then look at the buffer again. Every batch ended the same way: the
 * last few companies were still in flight, the other workers had nothing left to
 * take, and they sat idle until the slowest one finished. A company is slow when
 * its site is bot-blocked (the page fetch walks through three layers and is
 * allowed ~55 seconds), so that tail is long, and it happened once per 32
 * companies. With eight workers and a typical company at 15-20 seconds, a third
 * or more of the pass could go on waiting.
 *
 * Here the queue is shared. A worker that finishes simply takes the next
 * company, so the only time anyone is idle is when there is genuinely nothing
 * left to read.
 *
 * And the queue can be fed from outside while the workers are running: the
 * discovery channels that answer late (see discovery-merge.ts) push their
 * candidates in when they land, and `arrivals` tells an idle worker whether it is
 * worth waiting for them or whether the pool is finished.
 */

/**
 * @param queue     The shared buffer. Items are taken off the FRONT. Anything left
 *                  when the pool stops is simply still in it, so a caller that
 *                  stopped early needs no "put the unstarted ones back" step.
 * @param limit     How many items are in flight at once.
 * @param run       Work on one item.
 * @param shouldStop Checked before EACH item, and again after any wait for new
 *                  arrivals, so a run that is out of time stops mid-queue instead
 *                  of starting a read it cannot finish.
 * @param arrivals  The next point at which the queue may have been added to, or
 *                  null when nothing more is coming. An idle worker waits on it
 *                  and looks again; when it is null the idle worker retires. It
 *                  must never reject.
 */
export async function drainQueue<T>(
  queue: T[],
  limit: number,
  run: (item: T) => Promise<void>,
  shouldStop: () => boolean,
  arrivals?: () => Promise<unknown> | null
): Promise<void> {
  async function worker() {
    for (;;) {
      if (shouldStop()) return;
      const item = queue.shift();
      if (item === undefined) {
        const next = arrivals?.() ?? null;
        if (!next) return;
        await next;
        continue;
      }
      await run(item);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
}

/**
 * Wait for a promise, but never longer than `ms`. Resolves either way and never
 * rejects, and clears its own timer, so a caller can wait on something slow
 * (a discovery channel still crawling) without being held past a deadline by it.
 */
export function waitUpTo(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    const release = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(release, release);
  });
}
