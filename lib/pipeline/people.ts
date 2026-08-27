import type { createServiceRoleClient } from "../supabase/server";

/**
 * The people at a company, and which one the next paid lookup is for.
 *
 * WHY IT LIVES IN `contacts` AND NOT ITS OWN TABLE.
 *
 * Jonathan asked for up to five names per company: he opened Hansmann
 * Construction, corrected the founder, and then found Dave (another son) and
 * Julie as well, with two slots to put four people in. The obvious home is a
 * company_people table and the migration for it is written.
 *
 * It cannot be applied from here. This app holds a PostgREST key, PostgREST
 * does not execute DDL, there is no Supabase CLI or access token on the
 * machine, and the service-role key is rejected by the management API. Running
 * it needs a person to paste it. Twice now that has blocked a request Jonathan
 * made, so this stops waiting.
 *
 * `contacts` already carries company_id, name, title and a NULLABLE email --
 * rows with no address are ordinary there, since a lookup that finds nothing
 * writes one. A person we know about and have no address for is exactly that
 * shape. So the extra people are contacts rows with a name and no email, and
 * `find_source` records what they are:
 *
 *   user:person          somebody typed in by hand
 *   user:person:target   the same, and the one enrichment should buy for
 *
 * WHAT STAYS PUT. companies.founder_name and next_gen_name are untouched.
 * They are the crawler's record of what the page said, the thing the evidence
 * argument rests on, and they must not quietly become an editing surface. The
 * people list is who to call. Different question, different storage.
 *
 * WHEN THE TABLE ARRIVES, these rows migrate into it: same fields, same
 * meanings, one insert-select. Nothing here has to be unpicked.
 */

export const PERSON_SOURCE = "user:person";
export const PERSON_TARGET_SOURCE = "user:person:target";

/** Room for a founder, a couple of children, and a manager. Jonathan's ask. */
export const MAX_PEOPLE = 5;

export interface Person {
  /** A contacts row id for hand-added people; null for the two crawler slots. */
  id: string | null;
  name: string;
  title: string | null;
  /** Where this person came from, which decides whether they can be deleted. */
  origin: "founder" | "next_gen" | "user";
  /** The one enrichment buys an address for. Exactly one is ever true. */
  isTarget: boolean;
  /** An address already on file for them, if any. */
  email: string | null;
}

/** The service-role client. Server-only, which this module is. */
type Db = ReturnType<typeof createServiceRoleClient>;

interface CompanyRow {
  founder_name: string | null;
  founder_title: string | null;
  next_gen_name: string | null;
  next_gen_title: string | null;
}

interface ContactRow {
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  find_source: string | null;
  find_status: string;
}

/**
 * Everybody at a company, crawler slots first, then hand-added.
 *
 * The target is whoever carries the flag; with nobody flagged it falls back to
 * the rule enrichment has always used -- the next generation when there is
 * one, the founder otherwise -- so a company nobody has edited behaves exactly
 * as it did before this existed.
 */
export function peopleFrom(company: CompanyRow, contacts: ContactRow[]): Person[] {
  const flagged = contacts.find((c) => c.find_source === PERSON_TARGET_SOURCE && c.name);

  const out: Person[] = [];
  if (company.founder_name) {
    out.push({
      id: null,
      name: company.founder_name,
      title: company.founder_title,
      origin: "founder",
      isTarget: false,
      email: null,
    });
  }
  if (company.next_gen_name) {
    out.push({
      id: null,
      name: company.next_gen_name,
      title: company.next_gen_title,
      origin: "next_gen",
      isTarget: false,
      email: null,
    });
  }

  for (const c of contacts) {
    const src = c.find_source ?? "";
    if (!c.name) continue;
    if (src !== PERSON_SOURCE && src !== PERSON_TARGET_SOURCE) continue;
    // A hand-added person whose name matches a crawler slot is the same human,
    // not a sixth entry. Keeps the list honest when somebody re-types a name
    // that was already there.
    const dupe = out.find((p) => p.name.trim().toLowerCase() === c.name!.trim().toLowerCase());
    if (dupe) {
      dupe.id = c.id;
      dupe.origin = "user";
      dupe.email = c.email;
      continue;
    }
    out.push({
      id: c.id,
      name: c.name,
      title: c.title,
      origin: "user",
      isTarget: false,
      email: c.email,
    });
  }

  // Any address already on file, matched by name, so the list can show who is
  // already reachable without a second query.
  for (const p of out) {
    if (p.email) continue;
    const hit = contacts.find(
      (c) => c.email && c.name && c.name.trim().toLowerCase() === p.name.trim().toLowerCase()
    );
    if (hit) p.email = hit.email;
  }

  if (flagged) {
    const t = out.find((p) => p.id === flagged.id) ?? out.find((p) => p.name === flagged.name);
    if (t) t.isTarget = true;
  }
  if (!out.some((p) => p.isTarget)) {
    const fallback = out.find((p) => p.origin === "next_gen") ?? out[0];
    if (fallback) fallback.isTarget = true;
  }
  return out.slice(0, MAX_PEOPLE);
}

/** Read a company's people in one round trip. */
export async function loadPeople(db: Db, companyId: string): Promise<Person[]> {
  const [{ data: company }, { data: contacts }] = await Promise.all([
    db
      .from("companies")
      .select("founder_name, founder_title, next_gen_name, next_gen_title")
      .eq("id", companyId)
      .maybeSingle(),
    db.from("contacts").select("id, name, title, email, find_source, find_status").eq("company_id", companyId),
  ]);
  if (!company) return [];
  return peopleFrom(company as CompanyRow, (contacts ?? []) as ContactRow[]);
}

/**
 * Point the next lookup at one person.
 *
 * The flag lives on a contacts row, so choosing one of the two crawler slots
 * creates a row for them. That row carries no email and never will unless a
 * lookup finds one: it exists to say "this is who we want".
 */
export async function setTarget(db: Db, companyId: string, person: { name: string; title: string | null }) {
  // Clear the old flag first. Demoting to the plain person source rather than
  // deleting keeps the person in the list, which is what an untick means.
  const { data: current } = await db
    .from("contacts")
    .select("id")
    .eq("company_id", companyId)
    .eq("find_source", PERSON_TARGET_SOURCE);
  for (const row of current ?? []) {
    await db.from("contacts").update({ find_source: PERSON_SOURCE }).eq("id", row.id);
  }

  const { data: existing } = await db
    .from("contacts")
    .select("id, find_source")
    .eq("company_id", companyId)
    .ilike("name", person.name)
    .limit(1);

  const row = (existing ?? [])[0];
  if (row) {
    // Never overwrite the source of a row holding a PURCHASED address: that
    // would lose how the address was found, which is the audit trail.
    const src = String(row.find_source ?? "");
    if (src === PERSON_SOURCE || src === PERSON_TARGET_SOURCE || src === "") {
      await db.from("contacts").update({ find_source: PERSON_TARGET_SOURCE }).eq("id", row.id);
      return;
    }
  }

  await db.from("contacts").insert({
    company_id: companyId,
    name: person.name,
    title: person.title,
    email: null,
    name_inferred: false,
    find_status: "not_attempted",
    find_source: PERSON_TARGET_SOURCE,
    verification_status: "not_attempted",
  });
}

/** Add somebody the page never named. */
export async function addPerson(
  db: Db,
  companyId: string,
  person: { name: string; title: string | null }
): Promise<{ error?: string }> {
  const people = await loadPeople(db, companyId);
  if (people.length >= MAX_PEOPLE) {
    return { error: `That is the limit of ${MAX_PEOPLE} people on one company.` };
  }
  if (people.some((p) => p.name.trim().toLowerCase() === person.name.trim().toLowerCase())) {
    return { error: "That person is already listed." };
  }
  const { error } = await db.from("contacts").insert({
    company_id: companyId,
    name: person.name,
    title: person.title,
    email: null,
    name_inferred: false,
    find_status: "not_attempted",
    find_source: PERSON_SOURCE,
    verification_status: "not_attempted",
  });
  return error ? { error: error.message } : {};
}

/**
 * Remove somebody.
 *
 * A row holding a real address is never deleted here -- that address was
 * bought or scraped and is part of the record. Only the name-only rows this
 * module creates go.
 */
export async function removePerson(db: Db, companyId: string, contactId: string): Promise<{ error?: string }> {
  const { data: row } = await db
    .from("contacts")
    .select("id, email, find_source")
    .eq("id", contactId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!row) return { error: "No such person here." };
  if (row.email) {
    return { error: "That one has an email address on file, so it is kept." };
  }
  const { error } = await db.from("contacts").delete().eq("id", contactId);
  return error ? { error: error.message } : {};
}
