/**
 * Merging what the discovery channels return, and handing it over in TWO parts.
 *
 * WHY TWO PARTS. A discovery round runs four channels at once and used to wait
 * for the slowest before anything could be read. The slowest is almost always
 * Google Maps (a crawler actor that visits every place, with a timeout of up to
 * 280 seconds), and it is the channel that yields least: on this installation's
 * own reads, one qualified pair per ~170 companies against one per ~30 from web
 * search. So every round, the whole pass stood idle for the sake of the
 * candidates least likely to matter, with eight workers and nothing to give them.
 *
 * Now the round is delivered as:
 *
 *   first  Web search (the channel that earns its keep) plus anything else that
 *          has already answered, a few seconds after web search does. Reading
 *          starts here.
 *   rest   Whatever the slower channels returned afterwards. NOTHING IS DROPPED:
 *          it was paid for, so it joins the back of the queue when it lands.
 *
 * `first` waits for everything when it has nothing to offer, so a round that
 * finds no candidates behaves exactly as it did, errors and all.
 *
 * The merge rules themselves (host-level dedupe, blocked hosts, the state a
 * candidate is stamped with, the wording of the channel warnings and the "all
 * three searching channels failed" error) are unchanged, and tested. The
 * wording matters: channel-health.ts parses these strings.
 */

/** Order is the priority when two channels return the same company. */
export const CHANNEL_NAMES = ["Directory", "Licensing", "Web search", "Maps"] as const;
const WEB_SEARCH = 2;

export interface Merged<C> {
  candidates: C[];
  channelErrors: string[];
}

type Settled<R> = PromiseFulfilledResult<R[]> | PromiseRejectedResult;

export interface ProgressiveArgs<R extends { state?: string | null }, C> {
  /**
   * One promise per (state group, channel), group-major: the task for group g
   * and channel c is `tasks[g * CHANNEL_NAMES.length + c]`.
   */
  tasks: Promise<R[]>[];
  /** The states each group covers; a single-state group stamps its candidates. */
  groups: string[][];
  /**
   * How long after web search answers to wait for the other channels before
   * handing over the first part. Infinity waits for all of them, which is the
   * old behaviour exactly.
   */
  graceMs: number;
  /**
   * The longest the first part waits for web search, when something else has
   * already come back with candidates. Web search is the channel worth waiting
   * for, but its latency has a long tail (36 to 145 s measured), and the others
   * answer in about 12 s. Past this, reading starts on what is here and web
   * search's candidates join as they land. Ignored when nothing else has any.
   */
  maxLeadWaitMs?: number;
  /**
   * Turn a raw result into a candidate, or null to drop it (no usable host, a
   * blocked host, or one already seen). Must add what it keeps to `seen`.
   */
  convert: (raw: R, seen: Set<string>) => C | null;
  /** Domains that must not be returned again. Not modified. */
  exclude?: Set<string>;
  /**
   * Told as each call comes back, with how long it took. For the logs: how long
   * each channel REALLY takes decides when reading can start, and that was a
   * guess until it was written down.
   */
  onSettle?: (info: SettleInfo) => void;
}

export interface SettleInfo {
  channel: (typeof CHANNEL_NAMES)[number];
  /** The states of the group that made the call. */
  group: string;
  ms: number;
  /** How many results it returned; null when it failed. */
  count: number | null;
  error: string | null;
}

export function progressiveDiscovery<R extends { state?: string | null }, C>(
  args: ProgressiveArgs<R, C>
): { first: Promise<Merged<C>>; rest: Promise<Merged<C>> } {
  const { tasks, groups, graceMs, convert, onSettle } = args;
  const nCh = CHANNEL_NAMES.length;
  const seen = new Set<string>(args.exclude ?? []);
  const startedAt = Date.now();

  const report = (i: number, count: number | null, error: string | null) => {
    try {
      onSettle?.({
        channel: CHANNEL_NAMES[i % nCh],
        group: groups[Math.floor(i / nCh)].join("/"),
        ms: Date.now() - startedAt,
        count,
        error,
      });
    } catch {
      // a logging hook must never change what discovery returns
    }
  };

  const settled: (Settled<R> | undefined)[] = tasks.map(() => undefined);
  const done = tasks.map((t, i) =>
    t.then(
      (value) => {
        settled[i] = { status: "fulfilled", value };
        report(i, value.length, null);
      },
      (reason) => {
        settled[i] = { status: "rejected", reason };
        report(i, null, String(reason?.message ?? reason).slice(0, 120));
      }
    )
  );
  const allDone = Promise.all(done).then(() => undefined);

  /** Every group's call for this channel has come back, one way or the other. */
  const channelDone = (ch: number) => groups.every((_, g) => settled[g * nCh + ch] !== undefined);

  /** Merge the named channels, which must all be settled. */
  function merge(channels: number[]): Merged<C> & { failedEverywhere: Map<number, boolean> } {
    const candidates: C[] = [];
    const channelErrors: string[] = [];
    const failedEverywhere = new Map<number, boolean>();

    for (const ch of channels) {
      const forChannel = groups.map((_, g) => settled[g * nCh + ch] as Settled<R>);
      const ok = forChannel.filter((r): r is PromiseFulfilledResult<R[]> => r.status === "fulfilled");

      // Stamp the state of the group that issued the call. This is the only
      // point in the pipeline that still knows it: by the time a candidate
      // reaches the orchestrator the groups have been merged into one list.
      forChannel.forEach((r, g) => {
        if (r.status !== "fulfilled") return;
        const stateOfGroup = groups[g].length === 1 ? groups[g][0] : null;
        for (const c of r.value) {
          const kept = convert({ ...c, state: c.state ?? stateOfGroup }, seen);
          if (kept) candidates.push(kept);
        }
      });

      failedEverywhere.set(ch, ok.length === 0);
      // A channel counts as failed only when it failed for EVERY state group:
      // one state's timeout must not condemn a channel that worked elsewhere.
      if (ok.length === 0) {
        const first = forChannel[0] as PromiseRejectedResult;
        channelErrors.push(
          `${CHANNEL_NAMES[ch]} channel failed: ${first?.reason?.message?.slice(0, 150) ?? first?.reason}`
        );
      } else if (ok.length < forChannel.length) {
        const failed = forChannel
          .map((r, g) => (r.status === "rejected" ? groups[g].join("/") : null))
          .filter(Boolean);
        channelErrors.push(`${CHANNEL_NAMES[ch]} channel failed for ${failed.join(", ")} only`);
      }
    }
    return { candidates, channelErrors, failedEverywhere };
  }

  const everyChannel = CHANNEL_NAMES.map((_, i) => i);
  let reported = new Set<number>();

  const first = (async (): Promise<Merged<C>> => {
    if (Number.isFinite(graceMs)) {
      const webSearchBack = Promise.all(groups.map((_, g) => done[g * nCh + WEB_SEARCH]));
      await Promise.race([
        webSearchBack.then(() => new Promise<void>((r) => setTimeout(r, graceMs))),
        allDone,
        // A ceiling on the wait. It only ends the wait EARLY if something else has
        // candidates to read: with nothing, the check below keeps waiting.
        ...(args.maxLeadWaitMs !== undefined ? [new Promise<void>((r) => setTimeout(r, args.maxLeadWaitMs))] : []),
      ]);
      const ready = everyChannel.filter(channelDone);
      const early = merge(ready);
      if (early.candidates.length > 0) {
        reported = new Set(ready);
        return { candidates: early.candidates, channelErrors: early.channelErrors };
      }
    }

    // Nothing to read yet, or the caller wants it all at once: wait for the lot.
    await allDone;
    const all = merge(everyChannel);
    reported = new Set(everyChannel);

    // Deliberately still the THREE searching channels, not all four. Licensing
    // returns [] rather than throwing for a state with no free enumerable source
    // (most states), so folding it into this AND would mean a run where every
    // key is dead but the search happened to be for Texas fulfils quietly with
    // zero candidates instead of raising. That silent partial answer is the
    // exact thing channel-health.ts exists to prevent. A licensing rejection
    // still lands in channelErrors and surfaces as a warning.
    const dir = all.failedEverywhere.get(0);
    const web = all.failedEverywhere.get(WEB_SEARCH);
    const maps = all.failedEverywhere.get(3);
    if (dir && web && maps) throw new Error(all.channelErrors.join(" | "));

    return { candidates: all.candidates, channelErrors: all.channelErrors };
  })();

  const rest = first.then(
    async (): Promise<Merged<C>> => {
      await allDone;
      const late = everyChannel.filter((ch) => !reported.has(ch));
      if (late.length === 0) return { candidates: [], channelErrors: [] };
      const m = merge(late);
      return { candidates: m.candidates, channelErrors: m.channelErrors };
    },
    // `first` rejected: the caller has the error, and there is nothing to add.
    (): Merged<C> => ({ candidates: [], channelErrors: [] })
  );

  return { first, rest };
}
