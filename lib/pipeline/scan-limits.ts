/**
 * How much a single run is allowed to read, and how long that takes.
 *
 * These live in their own module rather than in orchestrator.ts because the
 * WEEKLY SCHEDULE SCREEN needs them, and that screen is a client component.
 * Importing them from the orchestrator would pull the entire server pipeline —
 * the service-role Supabase client and every vendor key path — into the browser
 * bundle. A three-constant module is the whole fix.
 */

/** Never scan more than target * this. */
export const MAX_SCAN_MULTIPLIER = 6;

/** Hard stop regardless of target — cost and time sanity. */
export const ABSOLUTE_SCAN_CEILING = 240;

/**
 * Measured end to end (fetch + classify + disprove), not estimated. Taken from
 * real runs against the live database, so the schedule screen's warning is
 * grounded in what the pipeline actually does rather than a guess.
 */
export const SECONDS_PER_COMPANY = 5.2;

/** Companies a run with this target will read at most. */
export function scansFor(targetSignals: number): number {
  return Math.min(targetSignals * MAX_SCAN_MULTIPLIER, ABSOLUTE_SCAN_CEILING);
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
export function passesNeeded(targetSignals: number, ceilingMs: number): number {
  const seconds = scansFor(targetSignals) * SECONDS_PER_COMPANY;
  return Math.max(1, Math.ceil((seconds * 1000) / ceilingMs));
}

/** Companies a single uninterrupted pass can read at this ceiling. */
export function companiesPerPass(ceilingMs: number): number {
  return Math.floor(ceilingMs / 1000 / SECONDS_PER_COMPANY);
}
