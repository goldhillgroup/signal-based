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
