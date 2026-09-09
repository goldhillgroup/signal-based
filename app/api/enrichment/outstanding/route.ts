import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

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
  const { data, error } = await service
    .from("companies")
    .select("search_id, contacts(email, find_status)")
    .eq("status", "qualified");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as {
    search_id: string | null;
    contacts: { email: string | null; find_status: string }[] | null;
  }[];

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
