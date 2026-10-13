import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readAllPages } from "@/lib/supabase/read-all";

/**
 * How many leads still have no address, per list, counted from the rows.
 *
 * WHY NOT THE FOLDER COUNTERS. searches.contacts_found is a running total the
 * enrichment pass increments, and it drifts: it counted intent rather than
 * results during the person_id bug, so three folders still carry a figure
 * ahead of what was actually written. Subtracting it gave 41 outstanding when
 * the true number is 368 -- an answer wrong by a factor of nine, on the one
 * number the "look them all up" button is priced from.
 *
 * One query over the companies and their contacts instead. Slower than
 * arithmetic on a counter, and right.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const service = createServiceRoleClient();
  // Only leads that are in a folder, filtered in the database. This used to fetch
  // every qualified company with all its contacts and throw the folderless ones
  // away afterwards, which was two thirds of the rows (346 of 517 on 2026-10-13),
  // on a request the sidebar makes for its badge.
  const rows = await readAllPages<{
    search_id: string | null;
    contacts: { email: string | null; find_status: string }[] | null;
  }>((from, to) =>
    service
      .from("companies")
      .select("id, search_id, contacts(email, find_status)")
      .eq("status", "qualified")
      .not("search_id", "is", null)
      .order("id")
      .range(from, to)
  );
  if (!rows) return NextResponse.json({ error: "Could not read the leads." }, { status: 500 });

  const byFolder: Record<string, number> = {};
  for (const c of rows) {
    if (!c.search_id) continue;
    const reachable = (c.contacts ?? []).some((k) => k.email && k.find_status === "found");
    if (reachable) continue;
    byFolder[c.search_id] = (byFolder[c.search_id] ?? 0) + 1;
  }
  const total = Object.values(byFolder).reduce((a, b) => a + b, 0);
  return NextResponse.json({ byFolder, total });
}
