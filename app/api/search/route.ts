import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runSearchPipeline } from "@/lib/pipeline/orchestrator";
import { industryLabel } from "@/lib/pipeline/parse-query";
import { stateNameFor } from "@/lib/pipeline/us-states";
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
const MAX_TARGET = 200; // UI-level sanity cap — see MAX_SCAN_MULTIPLIER/ABSOLUTE_SCAN_CEILING in the orchestrator for the real cost ceiling
const VALID_INDUSTRIES: Industry[] = ["landscaping", "home_builder"];
const VALID_MODES: SearchMode[] = ["signal", "filter", "hybrid"];

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    industry?: string;
    state?: string;
    refinement?: string;
    targetSignals?: number;
    mode?: string;
  };

  const industry = body.industry as Industry;
  if (!VALID_INDUSTRIES.includes(industry)) {
    return NextResponse.json(
      { error: "industry must be 'landscaping' or 'home_builder'" },
      { status: 400 }
    );
  }
  const state = (body.state ?? "").trim().toUpperCase();
  if (state.length !== 2) {
    return NextResponse.json({ error: "state is required (2-letter code)" }, { status: 400 });
  }
  const refinement = (body.refinement ?? "").trim();

  const mode = VALID_MODES.includes(body.mode as SearchMode) ? (body.mode as SearchMode) : "hybrid";

  const target = Math.min(
    Math.max(Math.round(body.targetSignals ?? 20), MIN_TARGET),
    MAX_TARGET
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Human-readable label built server-side from the structured fields — the
  // free-text refinement is along for the ride in the label/query only, it
  // never drives the actual discovery filters (see lib/pipeline/apify.ts).
  const label = `${industryLabel(industry)} companies in ${stateNameFor(state)}`;
  const query = refinement ? `${label} — ${refinement}` : label;

  const { data: search, error } = await supabase
    .from("searches")
    .insert({
      query,
      label,
      status: "running",
      mode,
      target_signals: target,
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
  after(() => runSearchPipeline(search.id, industry, [state], target, mode, refinement || null));

  return NextResponse.json({ id: search.id, label: search.label });
}
