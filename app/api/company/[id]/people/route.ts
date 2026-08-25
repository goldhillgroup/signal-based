import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { PersonRole, CompanyPersonRow } from "@/lib/supabase/types";

/**
 * The people at a company, and which of them the next lookup pays for.
 *
 * WHY THIS EXISTS. A company carried two name fields because the first brief
 * described two people. Jonathan hit the limit straight away: a builder with a
 * founder and two sons in the business can only have one of them looked up,
 * and which one was decided by whichever the classifier happened to name
 * first. He could see the problem and had no way to act on it.
 *
 * See supabase/migrations/20260819000000_company_people.sql for why this is a
 * table rather than more columns, and why the crawler's own founder_name /
 * next_gen_name are left alone: those are the record of what the page said,
 * and this is the list of who to call. Different things.
 *
 * GET     every person, target first
 * POST    add one
 * PATCH   rename, retitle, re-role, or make one the target
 * DELETE  remove one
 */

const ROLES = new Set<PersonRole>(["founder", "next_gen", "other"]);

function asRole(v: unknown): PersonRole | null {
  return typeof v === "string" && ROLES.has(v as PersonRole) ? (v as PersonRole) : null;
}

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
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("company_people")
    .select("id, name, title, role, is_target, source")
    .eq("company_id", id)
    .order("is_target", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ people: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const role: PersonRole = asRole(body.role) ?? "other";
  const title = cleanOptional(body.title) ?? null;
  const service = createServiceRoleClient();

  // First person on a company becomes the target: a company with exactly one
  // name and nobody selected would otherwise enrich nobody.
  const { count } = await service
    .from("company_people")
    .select("id", { count: "exact", head: true })
    .eq("company_id", id);
  const makeTarget = body.is_target === true || (count ?? 0) === 0;

  if (makeTarget) {
    await service.from("company_people").update({ is_target: false }).eq("company_id", id);
  }

  const { data, error } = await service
    .from("company_people")
    .insert({ company_id: id, name, title, role, is_target: makeTarget, source: "user" })
    .select("id, name, title, role, is_target, source")
    .single();

  if (error) {
    // The unique index on (company_id, lower(name)) is the intended guard, so
    // report it as the ordinary thing it is rather than a server failure.
    if (error.code === "23505") {
      return NextResponse.json({ error: "That person is already listed." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ person: data });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const personId = typeof body.person_id === "string" ? body.person_id : null;
  if (!personId) return NextResponse.json({ error: "Which person?" }, { status: 400 });

  const service = createServiceRoleClient();

  // company_id is checked on every write. Without it a crafted request could
  // retarget a person belonging to another company by id.
  const { data: owned } = await service
    .from("company_people")
    .select("id")
    .eq("id", personId)
    .eq("company_id", id)
    .maybeSingle();
  if (!owned) return NextResponse.json({ error: "No such person here." }, { status: 404 });

  const patch: Partial<CompanyPersonRow> = {};
  const name = cleanOptional(body.name);
  if (name !== undefined) {
    if (name === null) return NextResponse.json({ error: "A name is required." }, { status: 400 });
    patch.name = name;
  }
  const title = cleanOptional(body.title);
  if (title !== undefined) patch.title = title;
  const role = asRole(body.role);
  if (role) patch.role = role;
  // Editing a crawler row makes it the user's: a later re-crawl must not undo
  // a correction that was made by hand.
  if (Object.keys(patch).length > 0) patch.source = "user";

  // One target per company is a partial unique index, so the old one has to be
  // cleared before the new one is set or the second write violates it.
  if (body.is_target === true) {
    await service.from("company_people").update({ is_target: false }).eq("company_id", id);
    patch.is_target = true;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await service.from("company_people").update(patch).eq("id", personId);
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That person is already listed." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const personId = typeof body.person_id === "string" ? body.person_id : null;
  if (!personId) return NextResponse.json({ error: "Which person?" }, { status: 400 });

  const service = createServiceRoleClient();
  const { data: gone, error } = await service
    .from("company_people")
    .delete()
    .eq("id", personId)
    .eq("company_id", id)
    .select("is_target")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deleting the target leaves nobody selected, which would silently enrich
  // nobody. Promote whoever is left, by the same rule the backfill used.
  if (gone?.is_target) {
    const { data: rest } = await service
      .from("company_people")
      .select("id, role")
      .eq("company_id", id);
    const next =
      (rest ?? []).find((p) => p.role === "next_gen") ??
      (rest ?? []).find((p) => p.role === "founder") ??
      (rest ?? [])[0];
    if (next) {
      await service.from("company_people").update({ is_target: true }).eq("id", next.id);
    }
  }
  return NextResponse.json({ ok: true });
}
