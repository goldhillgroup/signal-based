import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runSearchPipeline } from "@/lib/pipeline/orchestrator";

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

export async function POST(req: Request) {
  const { query, targetSignals } = (await req.json().catch(() => ({}))) as {
    query?: string;
    targetSignals?: number;
  };
  if (!query || !query.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const target = Math.min(
    Math.max(Math.round(targetSignals ?? 20), MIN_TARGET),
    MAX_TARGET
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const trimmed = query.trim();
  const label = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;

  const { data: search, error } = await supabase
    .from("searches")
    .insert({
      query: trimmed,
      label,
      status: "running",
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
  after(() => runSearchPipeline(search.id, trimmed, target));

  return NextResponse.json({ id: search.id, label: search.label });
}
