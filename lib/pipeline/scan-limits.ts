import { countsTowardTarget } from "./target-count";
import type { SearchMode } from "../supabase/types";

/**
 * How much a single run is allowed to read, and how long that takes.
 *
 * These live in their own module rather than in orchestrator.ts because the
 * WEEKLY SCHEDULE SCREEN needs them, and that screen is a client component.
 * Importing them from the orchestrator would pull the entire server pipeline —
 * the service-role Supabase client and every vendor key path — into the browser
 * bundle. A three-constant module is the whole fix.
 */

/**
 * Never scan more than target * this — and how many reads a result costs
 * depends entirely on WHAT you are counting.
 *
 * There was one multiplier, 6, for every mode. That is about right for a
 * plain ICP fit: roughly one company in six passes the trade/size gates. It is
 * badly wrong for a succession signal, which is measured at about ONE IN
 * TWENTY on the best channel (web search: 4.8 confirmed pairs per 100 read;
 * Maps: 0.9).
 *
 * The consequence was arithmetic, not bad luck. Asking for 8 signals capped
 * the run at 8 x 6 = 48 companies, inside which about 2 pairs exist. The run
 * could not have delivered what was asked for however well it worked, and it
 * stopped looking convinced it was done.
 *
 * 20 is deliberately the measured rate rather than a safety factor on top of
 * it: half the runs will still fall short, and that is honest — a signal is
 * a real event in the world, not something more spending conjures. What this
 * fixes is a ceiling that made the request impossible to satisfy.
 */
export const MAX_SCAN_MULTIPLIER = 6;
export const SIGNAL_SCAN_MULTIPLIER = 20;

/**
 * Hard stop regardless of target — cost and time sanity.
 *
 * 240 until 2026-10-13. Jonathan asked for more than 50 per search because a
 * target of 50 returned 2-3 leads, and the arithmetic said why: a pair arrives
 * about one read in thirty, so 50 pairs needs ~1,500 reads and the ceiling
 * allowed 240. The request was unreachable by construction (the confirm dialog
 * said "reads up to 240 to find 50") however well the run worked.
 *
 * 1,000 is what a single search may read now. At roughly a cent a company that
 * is about $10, quoted on the confirm dialog before anything is bought, and it
 * is several automatic passes rather than one, which the pass logic already
 * supports. It is a ceiling on cost and time, not a promise: a search stops
 * earlier when the target is met or the pool runs dry.
 */
export const ABSOLUTE_SCAN_CEILING = 1000;

/**
 * Measured end to end (fetch + classify + disprove), not estimated. Taken from
 * real runs against the live database, so the schedule screen's warning is
 * grounded in what the pipeline actually does rather than a guess.
 */
//
// 5.2s was measured when pages were fetched a batch at a time and classified
// five at a time, with re-checks eating most of every pass. The pipeline now
// runs eight companies at once, each carrying its own fetch into its own
// classify, so the same wall-clock reads far more. 2.6s is an ESTIMATE from that
// concurrency (about 14s of work per company across 8 workers, plus discovery),
// deliberately on the cautious side; it only sizes the "about N passes" line on
// the form and should be re-measured from a real run's duration.
export const SECONDS_PER_COMPANY = 2.6;

/**
 * Companies a run with this target will read at most.
 *
 * `seekingSignals` covers 'signal' and 'hybrid' — both are asking for pairs,
 * and both were being cut off long before enough pages had been read for one
 * to appear. 'filter' keeps the old multiplier: it counts companies that fit,
 * and those genuinely do arrive one in six.
 */
export function scansFor(targetSignals: number, seekingSignals = false): number {
  const multiplier = seekingSignals ? SIGNAL_SCAN_MULTIPLIER : MAX_SCAN_MULTIPLIER;
  return Math.min(targetSignals * multiplier, ABSOLUTE_SCAN_CEILING);
}

/** Roughly how many confirmed pairs a target is likely to yield, measured. */
export function expectedSignals(targetSignals: number, seekingSignals = false): number {
  return Math.floor(scansFor(targetSignals, seekingSignals) / SIGNAL_SCAN_MULTIPLIER);
}

/**
 * How many presses of Search a target actually needs.
 *
 * A run that hits the platform's ceiling is NOT lost: reapStaleRuns closes the
 * row out honestly, everything already found is saved, and cross-search memory
 * means the next run skips every domain already settled and carries on from
 * where it stopped. So a big target on a small plan is not broken — it is two
 * or three presses instead of one.
 *
 * That is worth saying on the form rather than capping the options. Capping
 * would take away results the product can genuinely deliver; saying nothing
 * leaves someone watching a progress dialog stop at 57 and assuming it failed.
 */
export function passesNeeded(
  targetSignals: number,
  ceilingMs: number,
  seekingSignals = false
): number {
  const seconds = scansFor(targetSignals, seekingSignals) * SECONDS_PER_COMPANY;
  return Math.max(1, Math.ceil((seconds * 1000) / ceilingMs));
}

/** Companies a single uninterrupted pass can read at this ceiling. */
export function companiesPerPass(ceilingMs: number): number {
  return Math.floor(ceilingMs / 1000 / SECONDS_PER_COMPANY);
}

/**
 * Roughly how many confirmed pairs a run of this size will find.
 *
 * Distinct from expectedSignals above, which answers "is the request even
 * possible" using the generous 1-in-20 the ceiling is sized with. This one is
 * for TELLING SOMEONE what to expect, and uses what installations actually see:
 * web search measured one pair in 28 to 33 reads, and the all-channel figure is
 * lower still. Promising a number the run then misses is how "50 requested, 2
 * found" read as a broken product.
 */
export const LIKELY_PAIR_RATE = 1 / 30;
/** One accepted fit-only company in about six reads, measured. */
export const LIKELY_FIT_RATE = 1 / 6;

export function likelyPairs(reads: number): number {
  return Math.max(0, Math.round(reads * LIKELY_PAIR_RATE));
}

export function likelyFits(reads: number): number {
  return Math.max(0, Math.round(reads * LIKELY_FIT_RATE));
}

export type StopReason = "running" | "failed" | "target-met" | "pool-dry" | "ceiling";

export interface ContinuationInput {
  status: string;
  mode: SearchMode;
  targetSignals: number;
  companiesScanned: number;
  qualified: number;
  verify: number;
  fitOnly: number;
  poolExhausted: boolean;
}

/**
 * Can this folder take another pass, and if not, why not.
 *
 * ONE RULE for three callers: the continue route, the progress dialog, and the
 * folder page's "Keep searching" button. The route used to carry its own copy,
 * and it had drifted from the orchestrator in two ways that mattered:
 *
 *   - it measured the read ceiling with the FIT multiplier (6) for every mode,
 *     while the orchestrator used the pair multiplier (20) for hybrid and
 *     signal. A target of 8 was therefore refused at 48 companies read even
 *     though the run was allowed 160, which is why the default search stopped
 *     after one pass with roughly nothing found.
 *   - it counted fit-only companies toward the target in hybrid mode, while the
 *     orchestrator counts pairs only, so the two disagreed on whether the
 *     target had been met.
 *
 * Client-safe on purpose: the button needs the same answer the server will give.
 */
export function continuationState(f: ContinuationInput): {
  canContinue: boolean;
  reason: StopReason | null;
  found: number;
  ceiling: number;
} {
  const found = countsTowardTarget(f.mode, {
    qualified: f.qualified,
    verify: f.verify,
    fitOnly: f.fitOnly,
  });
  const ceiling = scansFor(f.targetSignals, f.mode !== "filter");

  let reason: StopReason | null = null;
  if (f.status === "running") reason = "running";
  else if (f.status === "failed") reason = "failed";
  else if (found >= f.targetSignals) reason = "target-met";
  else if (f.poolExhausted) reason = "pool-dry";
  else if (f.companiesScanned >= ceiling) reason = "ceiling";

  return { canContinue: reason === null, reason, found, ceiling };
}
