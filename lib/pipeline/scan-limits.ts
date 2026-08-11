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

/** Hard stop regardless of target — cost and time sanity. */
export const ABSOLUTE_SCAN_CEILING = 240;

/**
 * Measured end to end (fetch + classify + disprove), not estimated. Taken from
 * real runs against the live database, so the schedule screen's warning is
 * grounded in what the pipeline actually does rather than a guess.
 */
export const SECONDS_PER_COMPANY = 5.2;

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
