import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Closes out runs the server killed without telling anyone.
 *
 * The pipeline runs in `after()`, detached from the HTTP response, and Vercel
 * caps that at `maxDuration` (300s — see app/api/search/route.ts). When a run
 * exceeds it the function is terminated mid-loop. Every completion path in the
 * orchestrator lives at the END of that loop, so nothing marks the row: it
 * stays `status='running'` forever.
 *
 * Observed in production on 2026-08-09: a four-state landscaping run scanned 83
 * companies, was cut off at the ceiling, and sat at "16 of 20" indefinitely.
 * The 16 leads it had already paid for and written were real, but invisible —
 * the folder never left the running state, so the progress dialog polled a dead
 * row forever and the user had no way to tell a slow search from a dead one.
 *
 * A run cannot outlive `maxDuration` from the moment its row was created, so
 * `created_at` alone is a sound liveness test: past the ceiling plus grace, the
 * process is definitively gone. No heartbeat column, no cron, no migration.
 *
 * Deliberately marked `complete`, not `failed`. The work genuinely happened and
 * the companies are on disk; calling it a failure would imply otherwise and
 * hide real leads behind an error state. The warning carries the truth about
 * why it stopped early.
 */

/** Must match `export const maxDuration` in app/api/search/route.ts. */
export const RUN_CEILING_MS = 300_000;

/**
 * Grace on top of the ceiling. Covers cold start, queueing before the function
 * body runs, and clock skew between the DB and the runtime. Generous on
 * purpose: reaping a run that is actually alive would strand it far worse than
 * leaving a dead one a minute longer, because the orchestrator would carry on
 * writing to a row the UI has already closed out.
 */
export const REAP_GRACE_MS = 120_000;

export interface ReapResult {
  reaped: number;
  ids: string[];
}

export async function reapStaleRuns(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<ReapResult> {
  const cutoff = new Date(now.getTime() - RUN_CEILING_MS - REAP_GRACE_MS).toISOString();

  const { data, error } = await supabase
    .from("searches")
    .select("id, companies_scanned, qualified_count, verify_count, fit_only_count")
    .eq("status", "running")
    .lt("created_at", cutoff);

  if (error || !data || data.length === 0) return { reaped: 0, ids: [] };

  const ids: string[] = [];
  for (const row of data) {
    const scanned = row.companies_scanned ?? 0;
    const kept =
      (row.qualified_count ?? 0) + (row.verify_count ?? 0) + (row.fit_only_count ?? 0);

    const { error: updateErr } = await supabase
      .from("searches")
      .update({
        status: "complete",
        finished_at: now.toISOString(),
        candidates_pool_exhausted: false,
        warnings: stoppedEarlyMessage(scanned, kept),
      })
      .eq("id", row.id)
      // Re-assert the status in the WHERE clause. Between the select above and
      // this write the real run may have finished on its own; without this we
      // would overwrite a genuine result with a "stopped early" warning.
      .eq("status", "running");

    if (!updateErr) ids.push(row.id);
  }

  if (ids.length > 0) {
    console.warn(
      `Reaped ${ids.length} search run(s) killed by the ${RUN_CEILING_MS / 1000}s function ceiling: ${ids.join(", ")}`
    );
  }
  return { reaped: ids.length, ids };
}

/**
 * The same rescue for enrichment, which fails the same way.
 *
 * A killed pass leaves enrichment_status = 'running' forever, and the enrich
 * route refuses to start a second pass while one is running — so the folder
 * becomes permanently un-enrichable, with whatever contacts it had already
 * bought stranded behind a spinner.
 *
 * Dated from enrichment_started_at rather than created_at: enrichment begins
 * minutes or days after the search finished, so the search's own timestamps
 * say nothing about it. A row with no start time is LEFT ALONE — that is
 * either a row predating the column or a pass that never ran, and guessing
 * about either could close out a live pass mid-flight.
 *
 * Degrades to a no-op if the migration has not been applied yet, rather than
 * throwing inside the dashboard render.
 */
export async function reapStaleEnrichment(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<ReapResult> {
  const cutoff = new Date(now.getTime() - RUN_CEILING_MS - REAP_GRACE_MS).toISOString();

  const { data, error } = await supabase
    .from("searches")
    .select("id, contacts_found")
    .eq("enrichment_status", "running")
    .not("enrichment_started_at", "is", null)
    .lt("enrichment_started_at", cutoff);

  if (error) {
    // Unapplied migration: the column is unknown to PostgREST. Say so once and
    // carry on — enrichment still works, it just cannot be auto-rescued yet.
    if (/enrichment_started_at/.test(error.message ?? "")) {
      console.warn(
        "reapStaleEnrichment: enrichment_started_at column missing, apply supabase/migrations/20260809000000_enrichment_started_at.sql to enable enrichment recovery."
      );
    }
    return { reaped: 0, ids: [] };
  }
  if (!data || data.length === 0) return { reaped: 0, ids: [] };

  const ids: string[] = [];
  for (const row of data) {
    const { error: updateErr } = await supabase
      .from("searches")
      .update({
        // 'failed', not 'complete'. Unlike discovery, a half-finished
        // enrichment is genuinely incomplete work on a finished list, and the
        // UI offers "Retry enrichment" on failure — which is exactly the right
        // next action and costs nothing to re-run, since a company that
        // already has a contact row is skipped.
        enrichment_status: "failed",
        enrichment_error: `Stopped early: this pass hit the ${RUN_CEILING_MS / 1000 / 60} minute server limit after finding ${row.contacts_found ?? 0} email${(row.contacts_found ?? 0) === 1 ? "" : "s"}. Everything found is saved. Press Retry to pick up the rest, you are not charged twice for an address already found.`,
      })
      .eq("id", row.id)
      .eq("enrichment_status", "running");
    if (!updateErr) ids.push(row.id);
  }

  if (ids.length > 0) {
    console.warn(`Reaped ${ids.length} enrichment pass(es) killed by the function ceiling: ${ids.join(", ")}`);
  }
  return { reaped: ids.length, ids };
}

/**
 * Plain English, because this lands in front of the client. It says what
 * happened, that nothing was lost, and what to do — a bare "timed out" reads
 * like the results are suspect when they are not.
 */
export function stoppedEarlyMessage(scanned: number, kept: number): string {
  return (
    `Stopped early: this run hit the 5 minute server limit after checking ${scanned} ` +
    `companies. The ${kept} it had already found are saved and complete. ` +
    `Run the same search again to carry on from where it left off.`
  );
}
