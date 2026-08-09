import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Delete a search folder and everything under it.
 *
 * The database cascades: `companies.search_id` is ON DELETE CASCADE from
 * `searches`, and both `contacts.company_id` and `signal_evidence.company_id`
 * cascade from `companies`. So one delete removes the folder, its companies,
 * their contacts, and their evidence, with no orphans left behind.
 *
 * WHAT THIS ALSO DESTROYS, which is not obvious from the button:
 * those company rows ARE the cross-search memory (see the seeding query in
 * orchestrator.ts). Deleting a folder forgets that we ever looked at those
 * domains, along with every recheck date scheduled for them. The next search
 * over the same ground will rediscover and re-pay for all of it. That is the
 * real cost of this action, it is silent, and it is why the client asks for a
 * typed confirmation rather than a single click.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createServiceRoleClient();

  const { data: search, error: readErr } = await service
    .from("searches")
    .select("id, label, status")
    .eq("id", id)
    .single();

  if (readErr || !search) {
    return NextResponse.json({ error: "That search no longer exists." }, { status: 404 });
  }

  // Refuse to delete underneath a live run. The pipeline is still writing
  // companies against this id from a detached `after()` continuation, so
  // deleting now races it: the cascade removes rows the run then re-inserts,
  // leaving a half-populated folder with no parent. Wait for it to settle —
  // reapStaleRuns marks abandoned runs complete within minutes.
  if (search.status === "running") {
    return NextResponse.json(
      { error: "This search is still running. Wait for it to finish, then delete it." },
      { status: 409 }
    );
  }

  // Count first, so the response can report what actually went. Doing it after
  // the delete would always report zero.
  const { count: companyCount } = await service
    .from("companies")
    .select("*", { count: "exact", head: true })
    .eq("search_id", id);

  const { error: delErr } = await service.from("searches").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: `Could not delete: ${delErr.message}` }, { status: 500 });
  }

  console.warn(
    `Deleted search ${id} ("${search.label}") and ${companyCount ?? 0} companies, by ${user.email ?? user.id}`
  );

  return NextResponse.json({ id, label: search.label, companiesDeleted: companyCount ?? 0 });
}

/**
 * Rename a folder.
 *
 * The label is generated from the structured inputs ("Landscaping companies in
 * Texas"), which is a fine default and a poor name for work. Once there are a
 * dozen folders the useful name is his, not the generator's — "Houston round 2",
 * "for the Tuesday call" — and the label is the only thing distinguishing one
 * folder from another in the list.
 *
 * The QUERY is deliberately not touched. That is the record of what was
 * actually searched, and it is what a re-run would repeat; letting a rename
 * rewrite it would make the folder claim to be something it is not.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { label?: string };
  const label = (body.label ?? "").trim();

  if (!label) {
    return NextResponse.json({ error: "A folder needs a name." }, { status: 400 });
  }
  // Long enough for a real sentence, short enough that the list stays readable
  // and one pasted paragraph cannot wreck every card's layout.
  if (label.length > 120) {
    return NextResponse.json({ error: "Keep the name under 120 characters." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("searches")
    .update({ label })
    .eq("id", id)
    .select("id, label")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "That search no longer exists." }, { status: 404 });
  }
  return NextResponse.json(data);
}
