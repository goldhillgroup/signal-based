import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { enrichContacts, type EnrichScope } from "@/lib/pipeline/orchestrator";
import { enrichmentBlockerFor } from "@/lib/pipeline/preflight";

// Same extended-lifetime pattern as /api/search — see that route's comment.
// Enrichment is usually faster than discovery (no classification/disprove
// LLM calls, just one AnymailFinder + one MillionVerifier call per company),
// but scales the same way with result-set size, so give it the same runway.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Defaults to "signals" — the cheap branch. An enrichment request that
  // arrives without a scope (an old client, a retry, a curl) should buy the
  // 15 contacts, not the 124. Spending more has to be asked for explicitly.
  const body = (await req.json().catch(() => ({}))) as { scope?: string };
  const scope: EnrichScope = body.scope === "all" ? "all" : "signals";

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
      { error: "Discovery hasn't finished yet, wait for it to complete before enriching." },
      { status: 400 }
    );
  }
  if (search.enrichment_status === "running") {
    return NextResponse.json({ error: "Enrichment is already running for this search." }, { status: 409 });
  }

  // How many companies this scope will actually look up — the number the
  // credit check has to be made against, not the folder's total.
  let countQuery = service
    .from("companies")
    .select("*", { count: "exact", head: true })
    .eq("search_id", id)
    .eq("status", "qualified");
  if (scope === "signals") countQuery = countQuery.eq("has_signal", true);
  const { count: toEnrich } = await countQuery;

  const blocker = await enrichmentBlockerFor(toEnrich ?? 0);
  if (blocker) {
    return NextResponse.json({ error: blocker }, { status: 402 });
  }

  await service.from("searches").update({ enrichment_status: "running", enrichment_error: null }).eq("id", id);

  // Runs after this response is sent, within the extended function lifetime
  // (see maxDuration above) — the client polls the `searches` row for
  // enrichment_status/contacts_found/contacts_verified, same pattern as the
  // main search's progress polling.
  after(() => enrichContacts(id, scope));

  return NextResponse.json({ id, scope });
}
