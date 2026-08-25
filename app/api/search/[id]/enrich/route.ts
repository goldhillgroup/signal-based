import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { enrichContacts, type EnrichScope } from "@/lib/pipeline/orchestrator";
import { enrichmentBlockerFor } from "@/lib/pipeline/preflight";
import { reapStaleRuns, reapStaleEnrichment } from "@/lib/pipeline/reap";

// See app/api/search/route.ts for why 300 and how to raise it.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Defaults to "signals" — the cheap branch. An enrichment request that
  // arrives without a scope (an old client, a retry, a curl) should buy the
  // 15 contacts, not the 124. Spending more has to be asked for explicitly.
  const body = (await req.json().catch(() => ({}))) as {
    scope?: string;
    companyIds?: unknown;
    everyPerson?: unknown;
  };
  // Strict true only. An absent or malformed flag must mean the CHEAP branch:
  // this multiplies the bill by however many people a company lists, so it is
  // opted into explicitly or not at all.
  const everyPerson = body.everyPerson === true;
  // An explicit list wins over the scope word, and is only honoured when it is
  // actually a non-empty list of strings — a malformed body must fall back to a
  // narrower scope, never to a wider one.
  const rawIds = Array.isArray(body.companyIds)
    ? body.companyIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const companyIds = [...new Set(rawIds)].slice(0, 500);
  const scope: EnrichScope =
    companyIds.length > 0 ? "selected" : body.scope === "all" ? "all" : "signals";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createServiceRoleClient();

  // Settle any run the platform killed BEFORE reading the row.
  //
  // The pipeline now stops itself before the ceiling, so this is rare — but a
  // cold start or a slow vendor can still get a run terminated mid-loop, and
  // such a row stays status='running' forever. The check below then refuses to
  // enrich ("Discovery hasn't finished yet"), so a folder full of real,
  // paid-for leads becomes permanently un-enrichable. The reaper otherwise runs
  // only on a dashboard render, which is not a page you have to visit between
  // finishing a search and pressing Enrich.
  //
  // Never allowed to break the request: a reaper that 500s the endpoint it
  // exists to unblock is worse than the stuck row.
  try {
    await Promise.all([reapStaleRuns(service), reapStaleEnrichment(service)]);
  } catch (e) {
    console.warn(`Reap before enrich failed for ${id}:`, (e as Error).message);
  }

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
    .eq("search_id", id);
  if (scope === "selected") {
    // Counted through the same search_id filter the enrichment itself uses, so
    // ids belonging to another folder are neither charged for nor looked up.
    countQuery = countQuery.in("id", companyIds);
  } else {
    countQuery = countQuery.eq("status", "qualified");
    if (scope === "signals") countQuery = countQuery.eq("has_signal", true);
  }
  const { count: toEnrich } = await countQuery;

  if (scope === "selected" && (toEnrich ?? 0) === 0) {
    return NextResponse.json(
      { error: "None of the selected companies are in this folder." },
      { status: 400 }
    );
  }

  const blocker = await enrichmentBlockerFor(toEnrich ?? 0);
  if (blocker) {
    return NextResponse.json({ error: blocker }, { status: 402 });
  }

  // ATOMIC CLAIM, NOT A CHECK THEN A WRITE.
  //
  // The guard above reads enrichment_status and this line set it, with a
  // credit check in between. Two presses close together both read "idle", both
  // pass, and both start a run — and this is the one action that bills per
  // person found, so a double press is a double invoice.
  //
  // The condition moves into the UPDATE so the database decides the winner.
  // The loser gets nothing back and is turned away, exactly like the search
  // continuation route.
  const { data: claimed } = await service
    .from("searches")
    .update({ enrichment_status: "running", enrichment_error: null })
    .eq("id", id)
    .neq("enrichment_status", "running")
    .select("id");
  if (!claimed?.length) {
    return NextResponse.json(
      { error: "Enrichment is already running for this search." },
      { status: 409 }
    );
  }

  // Runs after this response is sent, within the extended function lifetime
  // (see maxDuration above) — the client polls the `searches` row for
  // enrichment_status/contacts_found/contacts_verified, same pattern as the
  // main search's progress polling.
  after(() => enrichContacts(id, scope, companyIds, everyPerson));

  return NextResponse.json({ id, scope, count: toEnrich ?? 0 });
}
