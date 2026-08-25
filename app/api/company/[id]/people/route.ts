import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Correct who a lead's founder and successor actually are.
 *
 * WHY THIS EXISTS. Jonathan checked a lead against the company's own site and
 * found the classifier had the generations the wrong way round: it read Steve
 * Hansman as the founder when the page says John Hansman founded it and Steve
 * runs it now. On another he found the successor on LinkedIn, a name the
 * website never prints at all.
 *
 * Both cases had the same dead end. Enrichment buys an address for
 * `next_gen_name ?? founder_name`, so a wrong name does not just look wrong,
 * it spends five cents looking up the wrong person and files the result as
 * though it were right. He could see the error and had no way to fix it.
 *
 * So: the four name and title fields are editable, and nothing else is. Not
 * the quote, not the source URL, not the verdict. Those are the record of what
 * the crawler actually read, and a product whose whole claim is "you can check
 * this against the live page" cannot let the evidence be rewritten. Who to
 * call is a judgement he is better placed to make than the model; what the
 * page said is a fact.
 */

const FIELDS = ["founder_name", "founder_title", "next_gen_name", "next_gen_title"] as const;
type Field = (typeof FIELDS)[number];

/** Empty string means "clear this", which is different from "leave it alone". */
function clean(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length === 0) return null;
  return t.slice(0, 120);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Partial<Record<Field, string | null>> = {};
  for (const f of FIELDS) {
    const v = clean(body[f]);
    if (v !== undefined) patch[f] = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // A successor with no founder is fine; a next-gen TITLE with no next-gen NAME
  // is a row that renders as a dangling ", President" with nobody attached.
  const service = createServiceRoleClient();
  const { data: current, error: readErr } = await service
    .from("companies")
    .select("founder_name, next_gen_name")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "No such company." }, { status: 404 });

  const nextGenAfter = patch.next_gen_name !== undefined ? patch.next_gen_name : current.next_gen_name;
  if (!nextGenAfter) patch.next_gen_title = null;
  const founderAfter = patch.founder_name !== undefined ? patch.founder_name : current.founder_name;
  if (!founderAfter) patch.founder_title = null;

  // EDITING PEOPLE INVALIDATES A PARKED GUESS, not a purchased address.
  //
  // The crawl parks addresses it scraped off the page, some of them matched to
  // the name it believed at the time. Correcting the name leaves those matched
  // to somebody who is no longer the target, and enrichment treats a matched
  // parked address as good enough to skip the paid lookup. Left alone, fixing
  // the name would be silently ignored on exactly the companies the fix
  // matters most for.
  //
  // Only the unpaid ones go. A contact that was actually bought stays: it cost
  // money, it may still be the right person, and deleting it on a title typo
  // would be its own bug.
  const { error: updErr } = await service.from("companies").update(patch).eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

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

  return NextResponse.json({ ok: true, clearedGuess });
}
