import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * When each list was last enriched.
 *
 * WHY A ROUTE RATHER THAN THE FOLDER STORE. `searches` records when a SEARCH
 * finished and has no column for when enrichment did. The activity panel
 * therefore sorted a folder enriched five minutes ago by a crawl that ran ten
 * days ago, and buried the one thing the reader opened the panel to find.
 *
 * contacts.created_at is the timestamp that already exists: the newest contact
 * on a folder is when enrichment last put something there. No migration, and
 * it is the real event rather than a proxy for it.
 *
 * A folder whose enrichment found NOTHING has no new contact and so no
 * timestamp. It falls back to the search date, which is honest -- there is no
 * record of when a pass that wrote nothing ran.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const service = createServiceRoleClient();

  // ONLY THE ROWS ENRICHMENT WROTE. This used to select every company with every
  // contact joined (~670 companies, 400 contacts), which took 0.8 to 1.1 seconds
  // on the live site, and it ran on every page load, up to six times. A lookup
  // leaves a row at "found" or "not_found"; a parked page address sits at
  // "not_attempted" and says nothing about when enrichment last ran. Filtering to
  // the first two and reading newest-first is a few hundred small rows, and the
  // first row seen for a search IS its latest enrichment.
  const { data, error } = await service
    .from("contacts")
    .select("created_at, companies!inner(search_id)")
    .neq("find_status", "not_attempted")
    .not("companies.search_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as {
    created_at: string;
    companies: { search_id: string | null } | { search_id: string | null }[] | null;
  }[];

  const lastEnrichedAt: Record<string, string> = {};
  for (const k of rows) {
    const co = Array.isArray(k.companies) ? k.companies[0] : k.companies;
    const id = co?.search_id;
    if (!id || !k.created_at) continue;
    // Newest first, so the first one seen is the answer.
    if (!lastEnrichedAt[id]) lastEnrichedAt[id] = k.created_at;
  }
  return NextResponse.json(
    { lastEnrichedAt },
    // The browser may reuse it for half a minute. The sidebar badge and the
    // History page both ask on every navigation, and the answer changes only
    // when an enrichment run finishes.
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}
