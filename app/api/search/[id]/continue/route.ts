import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { runSearchPipeline } from "@/lib/pipeline/orchestrator";
import { MAX_SCAN_MULTIPLIER, ABSOLUTE_SCAN_CEILING } from "@/lib/pipeline/scan-limits";
import type { Industry, SearchMode } from "@/lib/supabase/types";

// See app/api/search/route.ts for why 300 and how to raise it.
export const maxDuration = 300;

/**
 * Another pass into an EXISTING folder.
 *
 * A single serverless invocation reads about 57 companies before the platform
 * stops it, and a target of 100 needs 240. No plan changes that arithmetic
 * enough to matter — 800s on Pro still only buys ~150. So a large target is not
 * one long run, it is several passes accumulating into one folder, and this is
 * the endpoint that adds one.
 *
 * It is genuinely a CONTINUATION, not a re-run:
 *   - the same search_id, so the companies land in the same folder
 *   - the orchestrator seeds its counters from the rows already there, so the
 *     folder's totals grow instead of being overwritten
 *   - cross-search memory skips every domain already settled, so the pass
 *     spends its budget on companies nobody has read yet
 *   - the scan ceiling is measured against the accumulated total, so passes
 *     cannot collectively read more than one big run would have
 *
 * WHY IT REFUSES MORE OFTEN THAN IT ACCEPTS. This spends money with no human
 * watching the individual call, so every reason to stop is checked here rather
 * than trusted to the caller: the target is already met, the scan ceiling is
 * reached, the candidate pool ran dry, or a pass is already running. A
 * continuation loop that cannot terminate is the one failure mode that turns a
 * $0.70 search into a bill.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createServiceRoleClient();
  const { data: search, error } = await service
    .from("searches")
    .select(
      "id, status, query, mode, target_signals, revenue_min_musd, revenue_max_musd, candidates_pool_exhausted, companies_scanned, qualified_count, verify_count, fit_only_count"
    )
    .eq("id", id)
    .single();

  if (error || !search) {
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  }
  if (search.status === "running") {
    return NextResponse.json({ error: "A pass is already running." }, { status: 409 });
  }
  if (search.status === "failed") {
    return NextResponse.json({ error: "That search failed, start a new one." }, { status: 400 });
  }

  const target = search.target_signals ?? 0;
  const mode = (search.mode ?? "hybrid") as SearchMode;
  // Mirrors the orchestrator's countsTowardTarget: 'signal' mode counts only
  // real signals, everything else counts fit-only leads too.
  const found =
    mode === "signal"
      ? (search.qualified_count ?? 0) + (search.verify_count ?? 0)
      : (search.qualified_count ?? 0) + (search.verify_count ?? 0) + (search.fit_only_count ?? 0);

  if (found >= target) {
    return NextResponse.json({ continued: false, reason: "Target already reached.", found, target });
  }
  if (search.candidates_pool_exhausted) {
    return NextResponse.json({
      continued: false,
      reason: "No more companies to check for this search.",
      found,
      target,
    });
  }

  const scanCeiling = Math.min(target * MAX_SCAN_MULTIPLIER, ABSOLUTE_SCAN_CEILING);
  if ((search.companies_scanned ?? 0) >= scanCeiling) {
    return NextResponse.json({
      continued: false,
      reason: `Read ${search.companies_scanned} companies, the limit for a target of ${target}.`,
      found,
      target,
    });
  }

  // The parameters this folder was created with. Re-deriving them from the row
  // rather than taking them from the request body is deliberate: a continuation
  // must scan the same thing the first pass did, and a caller that could change
  // the industry or the states mid-folder would produce a folder whose contents
  // do not match its own label.
  const { data: sample } = await service
    .from("companies")
    .select("industry, state")
    .eq("search_id", id)
    .limit(200);

  const industry = (sample?.[0]?.industry ?? "landscaping") as Industry;
  const states = [...new Set((sample ?? []).map((c) => c.state).filter((s): s is string => !!s && s !== "-"))];

  // ── CLAIM THE PASS ATOMICALLY ────────────────────────────────────────
  //
  // The status check at the top of this handler is NOT a lock. Two continues
  // arriving within the same second both read 'complete', both pass that check,
  // and both start a pipeline — which is not merely wasteful, it CORRUPTS THE
  // COUNTS: each seeds from the same snapshot and the slower one then
  // overwrites the faster one's totals with its own lower numbers. Observed
  // live, twice in the same log:
  //
  //   Search 5bb296c8…: continuing — 36 already read, 9 kept, 21 cut.
  //   Search 5bb296c8…: continuing — 36 already read, 9 kept, 21 cut.
  //
  // and the folder's kept count went backwards from 19 to 14 while cut rose by
  // the same 5.
  //
  // Re-asserting status='complete' in the WHERE makes the transition the claim.
  // The database decides the winner, exactly once, and the loser is told so
  // before it can spend anything.
  const { data: claimed } = await service
    .from("searches")
    .update({ status: "running", finished_at: null })
    .eq("id", id)
    .eq("status", "complete")
    .select("id");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "A pass is already running." }, { status: 409 });
  }

  after(() =>
    runSearchPipeline(id, industry, states.length > 0 ? states : ["CA"], target, mode, null, {
      min: search.revenue_min_musd ?? null,
      max: search.revenue_max_musd ?? null,
    })
  );

  return NextResponse.json({ continued: true, found, target, scanned: search.companies_scanned });
}
