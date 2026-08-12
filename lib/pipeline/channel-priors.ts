import { createServiceRoleClient } from "../supabase/server";
import type { Candidate } from "./apify";

/**
 * How good each discovery channel actually is, and the ordering that follows.
 *
 * WHY THIS FILE EXISTS. Every company row already records which channel found
 * it and whether it carried a signal. Nothing ever read that back, so the
 * pipeline treated all four channels as equally worth classifying — while the
 * data said they differ by 7x.
 *
 * Measured on 195 attributed companies before the test database was cleared:
 *
 *   web_search   38 read ->  8 signals = 21.1%   ~$0.09 per signal
 *   directory    59 read ->  4 signals =  6.8%   ~$0.23 per signal
 *   maps         98 read ->  3 signals =  3.1%   ~$0.64 per signal
 *
 * Those observations are the SEED below. They are deliberately kept as data
 * rather than lost with the rows: the exploration that produced them was paid
 * for, and the ordering they imply is useful from the very first run rather
 * than after Jonathan accumulates his own few hundred companies.
 *
 * They are also explicitly provisional — n is small, and directory-vs-maps is
 * not statistically separable (4/59 vs 3/98, Fisher p=0.43). liveYields()
 * replaces them with his own numbers as soon as there is enough of his data to
 * beat them, per channel independently.
 *
 * WHAT THIS DOES NOT DO: it never drops a channel. Maps candidates are still
 * discovered and still classified — they simply sort to the back of the queue,
 * so the scan ceiling is spent on the best available candidates first. Cutting
 * maps outright would risk starving the pool, which is a supply problem, and
 * this is a priority problem. Keeping them means the pool cannot starve.
 */

export type Channel = Candidate["channel"];

/** Signal rate per channel, measured 2026-08-07. Provisional — see above. */
const SEED: Record<Channel, { reads: number; signals: number }> = {
  web_search: { reads: 38, signals: 8 },
  directory: { reads: 59, signals: 4 },
  maps: { reads: 98, signals: 3 },
  // Licensing emitted too few attributed rows to measure. Seeded neutral —
  // between directory and maps — so it is neither promoted nor buried on no
  // evidence. Its real rate will assert itself once it produces reads.
  licensing: { reads: 20, signals: 1 },
  // Re-checks are companies already known to fit; their discovery cost is zero,
  // so they are worth reading FIRST regardless of hit rate. Seeded high to
  // reflect the economics, not an observed rate.
  recheck: { reads: 10, signals: 3 },
};

/**
 * Laplace-smoothed rate. Raw signals/reads would rank a channel with 1 hit in
 * 2 reads above one with 8 in 38, which is noise beating evidence. Adding one
 * pseudo-hit and two pseudo-reads pulls small samples toward the middle until
 * they have earned an opinion.
 */
function rate(r: { reads: number; signals: number }): number {
  return (r.signals + 1) / (r.reads + 2);
}

/** Minimum observations before a channel's live rate is trusted over the seed. */
const MIN_LIVE_READS = 40;

/**
 * Live per-channel rates from this installation's own history, falling back to
 * the seed per channel until each has enough of its own data.
 *
 * Never throws: a failed read means "use the seeds", which is exactly the
 * behaviour on day one anyway.
 */
export async function channelRates(): Promise<Record<Channel, number>> {
  return (await channelEvidence()).rates;
}

/**
 * Rates AND how many observations stand behind them.
 *
 * The count is what lets exploration shrink. A fixed 25% reserve is right on
 * day one and wasteful once the answer is known: measured across 852 of this
 * installation's own reads, web search returns a confirmed pair once in 28
 * companies, Maps once in 152, and the directory channel has produced ZERO in
 * 106. Spending a quarter of every batch re-establishing that is not
 * exploration, it is a subsidy.
 */
export async function channelEvidence(): Promise<{
  rates: Record<Channel, number>;
  observations: number;
}> {
  const out = {} as Record<Channel, number>;
  for (const k of Object.keys(SEED) as Channel[]) out[k] = rate(SEED[k]);

  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("companies")
      .select("discovery_channel, has_signal")
      .not("discovery_channel", "is", null)
      .limit(5000);
    if (!data?.length) return { rates: out, observations: 0 };

    const live: Partial<Record<Channel, { reads: number; signals: number }>> = {};
    for (const row of data) {
      const c = row.discovery_channel as Channel;
      if (!(c in SEED)) continue;
      live[c] ??= { reads: 0, signals: 0 };
      live[c]!.reads++;
      if (row.has_signal) live[c]!.signals++;
    }
    let observed = 0;
    for (const [c, obs] of Object.entries(live) as [Channel, { reads: number; signals: number }][]) {
      observed += obs.reads;
      if (obs.reads >= MIN_LIVE_READS) out[c] = rate(obs);
    }
    return { rates: out, observations: observed };
  } catch {
    // seeds stand
  }
  return { rates: out, observations: 0 };
}

/**
 * How much of a batch to spend on channels that are NOT top-ranked.
 *
 * Decays from a quarter to a twelfth as this installation's own evidence
 * accumulates. The floor is deliberately not zero and never will be: the
 * ordering is otherwise self-fulfilling — a channel that has an unlucky week
 * sinks, stops being classified, stops generating evidence, and can never
 * recover however good it actually is. A twelfth is enough to keep every
 * channel earning observations while the leader takes the rest.
 *
 * HALF_LIFE is where the reserve sits midway between the two. 400 reads is
 * roughly two full searches at the current ceiling, which is about when the
 * per-channel numbers stopped moving in practice.
 */
const EXPLORE_MAX = 0.25;
const EXPLORE_MIN = 1 / 12;
const HALF_LIFE = 400;

export function explorationFor(observations: number): number {
  if (observations <= 0) return EXPLORE_MAX;
  const decay = HALF_LIFE / (HALF_LIFE + observations);
  return EXPLORE_MIN + (EXPLORE_MAX - EXPLORE_MIN) * decay;
}

/**
 * Orders a round's candidates best-channel-first.
 *
 * EXPLORATION FLOOR: a fixed fraction of every batch is reserved for channels
 * that are NOT currently top-ranked. Without it the ordering is self-fulfilling
 * — a channel that has an unlucky week sinks, stops being classified, stops
 * generating evidence, and can never recover no matter how good it actually is.
 * The floor is what keeps the estimate honest, and it is the difference between
 * a ranking and a ratchet.
 */
export function orderByYield(
  candidates: Candidate[],
  rates: Record<Channel, number>,
  explorationFraction = 0.25
): Candidate[] {
  if (candidates.length <= 1) return candidates;

  const sorted = [...candidates].sort(
    (a, b) => (rates[b.channel] ?? 0) - (rates[a.channel] ?? 0)
  );
  const best = sorted[0]?.channel;
  const others = sorted.filter((c) => c.channel !== best);
  if (others.length === 0) return sorted;

  // Interleave a slice of the non-top channels near the front so they keep
  // earning observations even while the leader dominates the batch.
  const reserve = Math.max(1, Math.floor(candidates.length * explorationFraction));
  const explorers = others.slice(0, reserve);
  const explorerSet = new Set(explorers);
  const rest = sorted.filter((c) => !explorerSet.has(c));

  const out: Candidate[] = [];
  const every = Math.max(2, Math.floor(rest.length / (explorers.length + 1)));
  let ei = 0;
  rest.forEach((c, i) => {
    out.push(c);
    if (ei < explorers.length && (i + 1) % every === 0) out.push(explorers[ei++]);
  });
  while (ei < explorers.length) out.push(explorers[ei++]);
  return out;
}
