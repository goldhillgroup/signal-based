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
