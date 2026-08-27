import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadPeople, addPerson, removePerson, setTarget, MAX_PEOPLE } from "@/lib/pipeline/people";

/**
 * The people at a company, and which of them the next lookup pays for.
 *
 * ONE PATH, not two. An earlier version of this file read a company_people
 * table and fell back to the two name columns when that table was missing.
 * The table has never been created -- see lib/pipeline/people.ts for why it
 * cannot be, from here -- so the fallback was the only path that ever ran and
 * the other half was dead code that had already broken Save once by claiming
 * requests the live editor was sending.
 *
 * People are stored in `contacts`, which already has company_id, name, title
 * and a nullable email. lib/pipeline/people.ts holds the reasoning.
 *
 * GET     everybody, up to five
 * POST    add one
 * PATCH   correct the two crawler slots, or choose who gets bought for
 * DELETE  remove a hand-added one
 */

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length === 0 ? null : t.slice(0, 120);
}

function cleanOptional(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length === 0 ? null : t.slice(0, 120);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const people = await loadPeople(createServiceRoleClient(), id);
  return NextResponse.json({ people, max: MAX_PEOPLE });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const service = createServiceRoleClient();
  const res = await addPerson(service, id, { name, title: cleanOptional(body.title) ?? null });
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 });

  return NextResponse.json({ people: await loadPeople(service, id) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const service = createServiceRoleClient();

  // CHOOSE WHO GETS BOUGHT FOR.
  if (body.target && typeof body.target === "object") {
    const t = body.target as Record<string, unknown>;
    const name = cleanName(t.name);
    if (!name) return NextResponse.json({ error: "Which person?" }, { status: 400 });
    await setTarget(service, id, { name, title: cleanOptional(t.title) ?? null }, t.selected !== false);
    return NextResponse.json({ people: await loadPeople(service, id) });
  }

  // CORRECT A HAND-ADDED PERSON, by contacts row id.
  if (typeof body.contact_id === "string") {
    const patch: { name?: string; title?: string | null } = {};
    const name = cleanOptional(body.name);
    if (name !== undefined) {
      if (name === null) return NextResponse.json({ error: "A name is required." }, { status: 400 });
      patch.name = name;
    }
    const title = cleanOptional(body.title);
    if (title !== undefined) patch.title = title;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    const { error } = await service
      .from("contacts")
      .update(patch)
      .eq("id", body.contact_id)
      .eq("company_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ people: await loadPeople(service, id) });
  }

  // CORRECT THE TWO CRAWLER SLOTS. The original behaviour, unchanged: these
  // are companies.founder_name / next_gen_name, what the page said.
  const FIELDS = ["founder_name", "founder_title", "next_gen_name", "next_gen_title"] as const;
  type NameField = (typeof FIELDS)[number];
  const patch: Partial<Record<NameField, string | null>> = {};
  for (const f of FIELDS) {
    const v = cleanOptional(body[f]);
    if (v !== undefined) patch[f] = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data: current, error: readErr } = await service
    .from("companies")
    .select("founder_name, next_gen_name")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "No such company." }, { status: 404 });

  // A name cleared clears its title, so a row cannot render as a dangling
  // ", President" with nobody attached to it.
  const nextGenAfter =
    patch.next_gen_name !== undefined ? patch.next_gen_name : current.next_gen_name;
  if (!nextGenAfter) patch.next_gen_title = null;
  const founderAfter =
    patch.founder_name !== undefined ? patch.founder_name : current.founder_name;
  if (!founderAfter) patch.founder_title = null;

  const { error } = await service.from("companies").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A name change invalidates an UNPAID address that was matched to the old
  // one: enrichment treats a name-matched parked address as good enough to
  // skip the paid lookup, so the correction would otherwise be ignored on
  // exactly the companies it matters most for. Purchased contacts stay.
  let clearedGuess = false;
  if (patch.founder_name !== undefined || patch.next_gen_name !== undefined) {
    const { data: dropped } = await service
      .from("contacts")
      .delete()
      .eq("company_id", id)
      .eq("find_status", "not_attempted")
      .like("find_source", "company-page:person_match%")
      .select("id");
    clearedGuess = (dropped ?? []).length > 0;
  }

  return NextResponse.json({ ok: true, clearedGuess, people: await loadPeople(service, id) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contactId = typeof body.contact_id === "string" ? body.contact_id : null;
  if (!contactId) return NextResponse.json({ error: "Which person?" }, { status: 400 });

  const service = createServiceRoleClient();
  const res = await removePerson(service, id, contactId);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ people: await loadPeople(service, id) });
}
