/**
 * The pool behind the pass: eight companies at a time, with nobody left idle
 * behind the slowest one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { drainQueue, waitUpTo } from "../lib/pipeline/drain-queue.js";

/** A promise a test settles by hand, so timing is decided by the test and not the clock. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

test("every item runs exactly once, and never more than `limit` at a time", async () => {
  const queue = Array.from({ length: 20 }, (_, i) => i);
  const seen: number[] = [];
  let inFlight = 0;
  let peak = 0;
  await drainQueue(
    queue,
    4,
    async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      seen.push(n);
      inFlight--;
    },
    () => false
  );
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i));
  assert.equal(peak, 4);
  assert.equal(queue.length, 0);
});

test("a worker that finishes takes the next item at once, without waiting for the others", async () => {
  // The whole point. Three workers, five items. Item 0 is slow, the rest are
  // quick. Under "run a batch, wait for all of it", workers 2 and 3 would sit
  // idle once the queue ran dry while item 0 was still going; here they keep
  // taking items until there are none, and item 0 holds only its own worker.
  const gates = Array.from({ length: 5 }, () => deferred());
  const started: number[] = [];
  const queue = [0, 1, 2, 3, 4];
  const pool = drainQueue(
    queue,
    3,
    async (n) => {
      started.push(n);
      await gates[n].promise;
    },
    () => false
  );
  await tick();
  assert.deepEqual(started, [0, 1, 2], "three start immediately");

  gates[1].resolve();
  await tick();
  assert.deepEqual(started, [0, 1, 2, 3], "item 1 finishing frees its worker for item 3 straight away");

  gates[2].resolve();
  await tick();
  assert.deepEqual(started, [0, 1, 2, 3, 4], "and item 2's worker takes item 4, though item 0 is still running");

  gates[3].resolve();
  gates[4].resolve();
  gates[0].resolve();
  await pool;
  assert.equal(queue.length, 0);
});

test("stopping leaves the unstarted items in the queue, ready for the next pass", async () => {
  const queue = [1, 2, 3, 4, 5, 6];
  let stop = false;
  const ran: number[] = [];
  await drainQueue(
    queue,
    2,
    async (n) => {
      ran.push(n);
      if (n === 2) stop = true;
      await tick();
    },
    () => stop
  );
  assert.ok(ran.length >= 2 && ran.length <= 3, `ran ${ran.length}`);
  assert.equal(queue.length, 6 - ran.length, "nothing was taken and then dropped");
  assert.deepEqual([...ran, ...queue].sort(), [1, 2, 3, 4, 5, 6]);
});

test("an idle worker waits for late arrivals and then reads them", async () => {
  // Discovery's slower channels land after the quick ones have been read.
  const queue = [1, 2];
  const late = deferred();
  let landed = false;
  const ran: number[] = [];
  const pool = drainQueue(
    queue,
    3,
    async (n) => {
      ran.push(n);
      await tick();
    },
    () => false,
    () => (landed ? null : late.promise)
  );
  await tick();
  await tick();
  assert.deepEqual(ran.sort(), [1, 2]);

  // They arrive while the workers are waiting.
  queue.push(3, 4, 5);
  landed = true;
  late.resolve();
  await pool;
  assert.deepEqual(ran.sort(), [1, 2, 3, 4, 5]);
});

test("with nothing coming, an idle worker retires instead of waiting for ever", async () => {
  const queue = [1];
  await drainQueue(queue, 8, async () => {}, () => false, () => null);
  assert.equal(queue.length, 0);
});

test("the stop check is made again after waiting, so a late arrival is not started past the deadline", async () => {
  const queue: number[] = [];
  const late = deferred();
  let stop = false;
  let landed = false;
  const ran: number[] = [];
  const pool = drainQueue(
    queue,
    2,
    async (n) => {
      ran.push(n);
    },
    () => stop,
    () => (landed ? null : late.promise)
  );
  await tick();
  // Time runs out while the workers wait; then the candidates land.
  stop = true;
  queue.push(7, 8);
  landed = true;
  late.resolve();
  await pool;
  assert.deepEqual(ran, [], "nothing was started after the stop");
  assert.deepEqual(queue, [7, 8], "and the late arrivals are still queued");
});

test("a throw surfaces instead of hanging the pool", async () => {
  // run() is expected to handle its own errors (the orchestrator's does), but a
  // throw must come out rather than leave the caller waiting for ever.
  const queue = [1, 2, 3];
  await assert.rejects(
    drainQueue(
      queue,
      2,
      async (n) => {
        if (n === 2) throw new Error("boom");
        await tick();
      },
      () => false
    ),
    /boom/
  );
});

test("waitUpTo returns when the promise does", async () => {
  const gate = deferred();
  const t0 = Date.now();
  const waiting = waitUpTo(gate.promise, 5_000);
  setTimeout(() => gate.resolve(), 20);
  await waiting;
  assert.ok(Date.now() - t0 < 1_000, "it did not sit out the full five seconds");
});

test("waitUpTo gives up at the limit when the promise is still pending", async () => {
  // A Maps call that is still crawling when the pass runs out of time.
  const t0 = Date.now();
  await waitUpTo(new Promise(() => {}), 40);
  const took = Date.now() - t0;
  assert.ok(took >= 35 && took < 1_000, `took ${took}ms`);
});

test("waitUpTo treats a rejection as 'it is over' rather than throwing", async () => {
  await waitUpTo(Promise.reject(new Error("late channel blew up")), 1_000);
});

test("waitUpTo with no time left returns at once", async () => {
  const t0 = Date.now();
  await waitUpTo(new Promise(() => {}), -5);
  assert.ok(Date.now() - t0 < 200);
});

test("onTake sees the queue as it stands, so the next supply can be fetched before it runs out", async () => {
  const queue = [1, 2, 3, 4, 5, 6];
  const remaining: number[] = [];
  await drainQueue(
    queue,
    1,
    async () => {},
    () => false,
    undefined,
    (n) => remaining.push(n)
  );
  assert.deepEqual(remaining, [5, 4, 3, 2, 1, 0]);
});

test("a throwing onTake does not stop the work", async () => {
  const queue = [1, 2, 3];
  const ran: number[] = [];
  await drainQueue(
    queue,
    2,
    async (n) => {
      ran.push(n);
    },
    () => false,
    undefined,
    () => {
      throw new Error("hook failed");
    }
  );
  assert.deepEqual(ran.sort(), [1, 2, 3]);
});
