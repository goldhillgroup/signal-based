import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runSearchPipeline } from "@/lib/pipeline/orchestrator";
import { getIcp } from "@/lib/pipeline/icp";
import { industryLabel, VALID_INDUSTRIES } from "@/lib/pipeline/intake-types";
import { stateNameFor, US_STATES, NATIONWIDE } from "@/lib/pipeline/us-states";
import { creditBlockerFor } from "@/lib/pipeline/preflight";
import type { Industry, SearchMode } from "@/lib/supabase/types";

// 300s, the default ceiling on EVERY Vercel plan.
//
// This was 800 for a while. 800 is only honoured on Pro with Fluid compute, and
// on a plan that caps lower Vercel does not quietly clamp it — the BUILD FAILS.
// Shipping a number that depends on an unverified plan setting turns a billing
// question into a broken deploy, so the safe value is the one that works
// everywhere.
//
// TO RAISE IT: confirm the project is on Pro with Fluid compute, then set this
// to 800 in all three routes (this one, the enrich route, the weekly cron) and
// RUN_CEILING_MS in lib/pipeline/reap.ts to match. All four move together or
// the reaper starts closing out runs that are still writing.
//
// At 300s a run reads about 48 companies before the platform stops it — see
// SECONDS_PER_COMPANY in lib/pipeline/scan-limits.ts. Nothing is lost when that
// happens: reapStaleRuns closes the row out honestly and everything already
// found is saved.
export const maxDuration = 300;

const MIN_TARGET = 1;
const MAX_TARGET = 200; // UI-level sanity cap, see MAX_SCAN_MULTIPLIER/ABSOLUTE_SCAN_CEILING in the orchestrator for the real cost ceiling
// Deliberately NOT redeclared here. A local copy of this list shadowed the
// shared one and stayed at the original two verticals, so the form offered
// eight and the API refused six of them — the end-to-end tests missed it
// entirely because they call runSearchPipeline directly and never cross this
// route. Imported from intake-types, which derives it from INDUSTRY_META.
const VALID_MODES: SearchMode[] = ["signal", "filter", "hybrid"];
const VALID_STATE_CODES = new Set(US_STATES.map((s) => s.code));

export async function POST(req: Request) {
  // AUTH FIRST, before the body is even read. It used to sit after all the
  // parameter validation, so an unauthenticated caller got
  // "industry must be 'landscaping' or 'home_builder'" — a 400 that quietly
  // taught them the API's shape and confirmed the endpoint exists. Nothing
  // about a request should be answered before knowing who is asking.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    industry?: string;
    industries?: unknown;
    state?: string;
    states?: string[];
    refinement?: string;
    includeAlreadyChecked?: boolean;
    targetSignals?: number;
    mode?: string;
    revenueMinMusd?: number | null;
    revenueMaxMusd?: number | null;
  };

  // A LIST now — the client can pick any combination, and an empty one means
  // every vertical in the ICP. `industry` is still accepted so an older
  // client, a retry or a curl keeps working.
  const rawIndustries = Array.isArray(body.industries)
    ? body.industries
    : body.industry
      ? [body.industry]
      : [];
  const industries = [...new Set(rawIndustries)].filter(
    (v): v is Industry => typeof v === "string" && VALID_INDUSTRIES.includes(v as Industry)
  );
  const industry = industries[0] as Industry;
  if (rawIndustries.length > 0 && industries.length === 0) {
    return NextResponse.json(
      { error: `industry must be one of: ${VALID_INDUSTRIES.join(", ")}` },
      { status: 400 }
    );
  }

  // Accepts either the single `state` the structured form has always sent or
  // the `states` array free-text intake produces ("Texas + Oklahoma", "the
  // Southeast"). One search covers all of them — a request the user made once
  // stays one folder — and the pipeline has always taken a states array.
  // Silently dropping a named state is the specific failure this replaces, so
  // an unknown code is a 400, never a quiet omission.
  const requested = (body.states?.length ? body.states : [body.state ?? ""])
    .map((s) => (s ?? "").trim().toUpperCase())
    .filter(Boolean);
  // A geography is REQUIRED, and empty is never silently reinterpreted.
  //
  // Phase 1 of the signed scope is "a custom crawler for one narrow niche in
  // one geography you pick", and the deliverable is a list dense enough to
  // prove the signal is real in a named territory. A run with no geography
  // produces a thin national scatter — worse evidence, from more money — so
  // the scope's "one geography" is a product decision, not a limitation to
  // work around. Reuse on other geographies means running it again for the
  // next one.
  //
  // NATIONWIDE ("US") is still accepted, because the pipeline supports it and
  // the crawler is his to reuse however he likes, but it is not offered in the
  // UI and it has to be asked for BY NAME. Inferring it from an empty list
  // would make "search the whole country" and "the form failed to send a
  // state" the same request, and a silent nationwide run is the expensive
  // half of that pair.
  const nationwide = requested.includes(NATIONWIDE);
  const states = nationwide ? [] : Array.from(new Set(requested));
  if (!nationwide && states.length === 0) {
    return NextResponse.json({ error: "state is required (2-letter code)" }, { status: 400 });
  }

  const unknown = states.filter((s) => !VALID_STATE_CODES.has(s));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unrecognized state code(s): ${unknown.join(", ")}` },
      { status: 400 }
    );
  }
  // Fall back to the saved ideal-client profile when this search doesn't state
  // its own focus. Applied HERE rather than only as a form default so that
  // every path into a search — the form, a parsed intake, a re-run — starts
  // from the same definition of a good lead. An explicit focus always wins;
  // this only fills a blank.
  const icp = await getIcp();
  const refinement = ((body.refinement ?? "").trim() || icp.signalFocus).trim();

  const mode = VALID_MODES.includes(body.mode as SearchMode) ? (body.mode as SearchMode) : "hybrid";

  const target = Math.min(
    Math.max(Math.round(body.targetSignals ?? 20), MIN_TARGET),
    MAX_TARGET
  );

  // Refuse BEFORE creating the folder. A search that starts without enough
  // credit to finish produces a half-populated folder that looks like a real
  // result — worse than no folder at all, because nothing on screen says it
  // was cut short. 402 tells you afterwards; this tells you instead.
  const creditBlocker = await creditBlockerFor(target);
  if (creditBlocker) {
    return NextResponse.json({ error: creditBlocker }, { status: 402 });
  }

  // Human-readable label built server-side from the structured fields. The
  // refinement is part of the query text AND, since refinementQueries, part of
  // what discovery actually searches for — it is no longer along for the ride.
  // A nationwide search has no states to list, and the old template produced
  // "Landscaping companies in " with nothing after it — a folder named after a
  // missing value, in a UI where the label is the only thing distinguishing
  // one folder from another.
  const where = states.length > 0 ? states.map(stateNameFor).join(", ") : "the United States";
  const label = `${industryLabel(industries)} companies in ${where}`;
  const query = refinement ? `${label}, ${refinement}` : label;

  const band = {
    min: "revenueMinMusd" in body ? (body.revenueMinMusd ?? null) : icp.revenueMinMusd,
    max: "revenueMaxMusd" in body ? (body.revenueMaxMusd ?? null) : icp.revenueMaxMusd,
  };

  const { data: search, error } = await supabase
    .from("searches")
    .insert({
      industries,
      query,
      label,
      status: "running",
      mode,
      target_signals: target,
      // Step 01's band. Both null = "no limit", which is a real choice in the
      // UI — so an ABSENT key falls back to the saved ideal-client band while
      // an explicit null stays null. `?? null` alone could not tell those two
      // apart and would have overridden a deliberate "no limit". Same `in`
      // test the schedule route uses, for the same reason.
      revenue_min_musd: band.min,
      revenue_max_musd: band.max,
      created_by: user.id,
    })
    .select("id, label")
    .single();

  if (error || !search) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create search" },
      { status: 500 }
    );
  }

  // Runs after this response is sent, within the extended function lifetime
  // (see maxDuration above) — the client polls the `searches` row for progress.
  after(() =>
    runSearchPipeline(
      search.id,
      industries,
      states,
      target,
      mode,
      refinement || null,
      band,
      body.includeAlreadyChecked === true
    )
  );

  return NextResponse.json({ id: search.id, label: search.label });
}
