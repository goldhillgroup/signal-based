import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadMarks } from "@/lib/lead-notes";

/**
 * Every note and grade, keyed by company id.
 *
 * The CSV is built in the browser, so it cannot reach app_settings the way the
 * xlsx route does. Without this the two exports disagreed: the spreadsheet
 * carried his notes and the CSV of the same leads did not, which is the kind
 * of difference nobody notices until the wrong file is the one forwarded.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ marks: await loadMarks(createServiceRoleClient()) });
}
