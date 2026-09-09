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
  const { data, error } = await service
    .from("companies")
    .select("search_id, contacts(created_at)")
    .not("search_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as {
    search_id: string | null;
    contacts: { created_at: string }[] | null;
  }[];

  const lastEnrichedAt: Record<string, string> = {};
  for (const c of rows) {
    if (!c.search_id) continue;
    for (const k of c.contacts ?? []) {
      const at = k.created_at;
      if (!at) continue;
      if (!lastEnrichedAt[c.search_id] || at > lastEnrichedAt[c.search_id]) {
        lastEnrichedAt[c.search_id] = at;
      }
    }
  }
  return NextResponse.json({ lastEnrichedAt });
}
