import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runSearchPipeline } from "@/lib/pipeline/orchestrator";

// Raise the ceiling where the deployment platform honors it (Vercel Pro+ with
// Fluid compute goes up to 800s). A full run — discover, one big page-fetch,
// then classify/disprove/find/verify per candidate — realistically takes
// 1-3 minutes for the 12-candidate cap in lib/pipeline/orchestrator.ts.
// On a platform that hard-caps shorter than this (e.g. Vercel Hobby's 10s),
// the background continuation WILL get killed mid-run — self-host or upgrade
// the plan before relying on this in production.
export const maxDuration = 300;

export async function POST(req: Request) {
  const { query } = (await req.json().catch(() => ({}))) as { query?: string };
  if (!query || !query.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

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
    .insert({ query: trimmed, label, status: "running", created_by: user.id })
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
  after(() => runSearchPipeline(search.id, trimmed));

  return NextResponse.json({ id: search.id, label: search.label });
}
