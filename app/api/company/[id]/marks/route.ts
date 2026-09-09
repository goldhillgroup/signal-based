import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadMarksFor, saveMarks } from "@/lib/lead-notes";

/**
 * Jonathan's own note and his own 1-5 for one lead.
 *
 * See lib/lead-notes.ts for why these live in app_settings rather than columns
 * on `companies`.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json(await loadMarksFor(createServiceRoleClient(), id));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { note?: unknown; grade?: unknown };
  const patch: { note?: string | null; grade?: number | null } = {};
  if (body.note !== undefined) patch.note = typeof body.note === "string" ? body.note : null;
  // null clears his grade and hands the lead back to the system's.
  if (body.grade !== undefined) patch.grade = body.grade === null ? null : Number(body.grade);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const service = createServiceRoleClient();
  const res = await saveMarks(service, id, patch);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json(await loadMarksFor(service, id));
}
