import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runSearchPipeline } from "@/lib/pipeline/orchestrator";
import { industryLabel } from "@/lib/pipeline/intake-types";
import { stateNameFor, US_STATES, NATIONWIDE } from "@/lib/pipeline/us-states";
import { creditBlockerFor } from "@/lib/pipeline/preflight";
import type { Industry, SearchMode } from "@/lib/supabase/types";

// Raise the ceiling where the deployment platform honors it (Vercel Pro+ with
// Fluid compute goes up to 800s). A full run loops discover -> fetch ->
// classify in rounds until the target signal count is hit or the safety
// ceiling in lib/pipeline/orchestrator.ts is reached — minutes, not seconds,
// scaling with the target. On a platform that hard-caps shorter than this
// (e.g. Vercel Hobby's 10s), the background continuation WILL get killed
// mid-run — self-host or upgrade the plan before relying on this in production.
export const maxDuration = 300;

const MIN_TARGET = 1;
const MAX_TARGET = 200; // UI-level sanity cap, see MAX_SCAN_MULTIPLIER/ABSOLUTE_SCAN_CEILING in the orchestrator for the real cost ceiling
const VALID_INDUSTRIES: Industry[] = ["landscaping", "home_builder"];
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
    state?: string;
    states?: string[];
    refinement?: string;
    targetSignals?: number;
    mode?: string;
    revenueMinMusd?: number | null;
    revenueMaxMusd?: number | null;
  };

  const industry = body.industry as Industry;
  if (!VALID_INDUSTRIES.includes(industry)) {
    return NextResponse.json(
      { error: "industry must be 'landscaping' or 'home_builder'" },
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
  const refinement = (body.refinement ?? "").trim();

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

  // Human-readable label built server-side from the structured fields — the
  // free-text refinement is along for the ride in the label/query only, it
  // never drives the actual discovery filters (see lib/pipeline/apify.ts).
  // A nationwide search has no states to list, and the old template produced
  // "Landscaping companies in " with nothing after it — a folder named after a
  // missing value, in a UI where the label is the only thing distinguishing
  // one folder from another.
  const where = states.length > 0 ? states.map(stateNameFor).join(", ") : "the United States";
  const label = `${industryLabel(industry)} companies in ${where}`;
  const query = refinement ? `${label}, ${refinement}` : label;

  const { data: search, error } = await supabase
    .from("searches")
    .insert({
      query,
      label,
      status: "running",
      mode,
      target_signals: target,
      // Step 01's band. Both null = "no limit" (an explicit choice in the UI),
      // so `?? null` rather than a default here — the UI owns the baseline.
      revenue_min_musd: body.revenueMinMusd ?? null,
      revenue_max_musd: body.revenueMaxMusd ?? null,
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
    runSearchPipeline(search.id, industry, states, target, mode, refinement || null, {
      min: body.revenueMinMusd ?? null,
      max: body.revenueMaxMusd ?? null,
    })
  );

  return NextResponse.json({ id: search.id, label: search.label });
}
