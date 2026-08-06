import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { enrichContacts } from "@/lib/pipeline/orchestrator";

// Same extended-lifetime pattern as /api/search — see that route's comment.
// Enrichment is usually faster than discovery (no classification/disprove
// LLM calls, just one AnymailFinder + one MillionVerifier call per company),
// but scales the same way with result-set size, so give it the same runway.
export const maxDuration = 300;

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
    .select("id, status, enrichment_status")
    .eq("id", id)
    .single();

  if (error || !search) {
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  }
  if (search.status !== "complete") {
    return NextResponse.json(
      { error: "Discovery hasn't finished yet — wait for it to complete before enriching." },
      { status: 400 }
    );
  }
  if (search.enrichment_status === "running") {
    return NextResponse.json({ error: "Enrichment is already running for this search." }, { status: 409 });
  }

  await service.from("searches").update({ enrichment_status: "running", enrichment_error: null }).eq("id", id);

  // Runs after this response is sent, within the extended function lifetime
  // (see maxDuration above) — the client polls the `searches` row for
  // enrichment_status/contacts_found/contacts_verified, same pattern as the
  // main search's progress polling.
  after(() => enrichContacts(id));

  return NextResponse.json({ id });
}
