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
/** An address Jonathan typed in himself, from wherever he found it. */
export const PERSON_TYPED_SOURCE = "user:typed";

/** Room for a founder, a couple of children, and a manager. Jonathan's ask. */
export const MAX_PEOPLE = 5;

export interface Person {
  /** A contacts row id for hand-added people; null for the two crawler slots. */
  id: string | null;
  name: string;
  title: string | null;
  /** Where this person came from, which decides whether they can be deleted. */
  origin: "founder" | "next_gen" | "user";
  /**
   * Ticked for enrichment. MORE THAN ONE MAY BE, which is the point: a
   * builder with a founder and two sons is three people worth an address, and
   * one radio button made that a choice between them.
   */
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
  name_inferred?: boolean | null;
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
  const flagged = contacts.filter((c) => c.find_source === PERSON_TARGET_SOURCE && c.name);

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
    if (!c.name) continue;
    // A NAMED ROW IS A PERSON, whatever wrote it.
    //
    // This used to admit only the user: sources, which meant assigning a
    // vendor-found address to somebody made them disappear: the row left the
    // loose list because it now had a name, and never joined the people list
    // because its source was still "anymailfinder:also:unmatched". Matt Scheff
    // existed in the database and nowhere on screen.
    //
    // Except an INFERRED name. Those are read off the mailbox by the vendor's
    // fallback -- doug@ becoming "Doug" on a lookup for John Turner -- and are
    // very often somebody else entirely. A guess is not a person.
    if (c.name_inferred) continue;
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

  for (const f of flagged) {
    const t = out.find((p) => p.id === f.id) ?? out.find((p) => p.name === f.name);
    if (t) t.isTarget = true;
  }
  // Nobody ticked is the old rule, unchanged: the next generation when there
  // is one, the founder otherwise. A company nobody has touched still enriches
  // exactly as it did before any of this existed.
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
    db
      .from("contacts")
      .select("id, name, name_inferred, title, email, find_source, find_status")
      .eq("company_id", companyId),
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
export async function setTarget(
  db: Db,
  companyId: string,
  person: { name: string; title: string | null },
  selected = true
) {
  // NO LONGER EXCLUSIVE. Ticking one person used to untick everybody else,
  // because enrichment could only ever buy for one. It can buy for each of
  // them now, so this sets one person's flag and leaves the rest alone.
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
      await db
        .from("contacts")
        .update({ find_source: selected ? PERSON_TARGET_SOURCE : PERSON_SOURCE })
        .eq("id", row.id);
      return;
    }
    // A row we must not touch, and unticking it is a no-op: it already holds
    // a bought address, so nothing more will be spent on that person anyway.
    return;
  }

  // Unticking somebody with no row of their own has nothing to write.
  if (!selected) return;

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

/**
 * A stored name split into the two boxes the editor shows.
 *
 * Names arrive as one string, because that is how a page writes them and how
 * the vendor returns them. Jonathan asked to edit them as first and last,
 * which is easier to correct and harder to get subtly wrong: retyping "John
 * Hansmann" to fix a surname means retyping the forename too, and a stray
 * space is invisible.
 *
 * The last token is the surname, EXCEPT when it is a generational suffix.
 * "Bill Madey Jr" splits to Bill / Madey Jr, not Bill Madey / Jr, because a
 * surname of "Jr" is nobody's, and because that suffix is exactly what tells
 * a son from his father in this product.
 *
 * Everything before the surname is the forename, so 'John "Hayden" Turner'
 * keeps its nickname rather than losing it to a tidy-up.
 */
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

export function splitName(full: string | null | undefined): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };

  let cut = parts.length - 1;
  if (NAME_SUFFIXES.has(parts[cut].toLowerCase()) && cut > 1) cut -= 1;
  return { first: parts.slice(0, cut).join(" "), last: parts.slice(cut).join(" ") };
}

/** The inverse, tolerating either box being left empty. */
export function joinName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ").replace(/\s+/g, " ");
}

/**
 * Record an address Jonathan found himself.
 *
 * His own question: "How can I add the emails that I found for Estes Design &
 * Manufacturing?" He had gone to their LinkedIn, then to their website, and
 * come back with addresses the crawler had not found and the vendor did not
 * sell. There was nowhere to put them, so the work was lost the moment he
 * closed the tab.
 *
 * Stored as find_status 'found' with its own source, so the list can say where
 * it came from. NOT verified: MillionVerifier costs money, and quietly
 * spending it because somebody typed in a box is a surprise. He can see it is
 * unchecked and decide.
 */
export async function setEmail(
  db: Db,
  companyId: string,
  person: { name: string; title: string | null },
  email: string | null
): Promise<{ error?: string }> {
  const clean = (email ?? "").trim().toLowerCase();
  if (clean && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(clean)) {
    return { error: `"${email}" does not look like an email address.` };
  }

  const { data: existing } = await db
    .from("contacts")
    .select("id, find_source, email")
    .eq("company_id", companyId)
    .ilike("name", person.name)
    .limit(1);
  const row = (existing ?? [])[0];

  // Never overwrite a PURCHASED address with a typed one without saying so:
  // that row records what was paid for and how it was found. A typed address
  // for the same person goes in beside it.
  const purchased =
    row && !String(row.find_source ?? "").startsWith("user:") && row.email;

  if (row && !purchased) {
    if (!clean) {
      // Clearing an address on a row that exists only to hold it removes the
      // row; one that also marks a target keeps its flag.
      const src = String(row.find_source ?? "");
      if (src === PERSON_TYPED_SOURCE) {
        await db.from("contacts").delete().eq("id", row.id);
        return {};
      }
      await db.from("contacts").update({ email: null, find_status: "not_attempted" }).eq("id", row.id);
      return {};
    }
    const { error } = await db
      .from("contacts")
      .update({
        email: clean,
        find_status: "found",
        find_source: PERSON_TYPED_SOURCE,
        verification_status: "not_attempted",
        verification_source: null,
        verified_at: null,
      })
      .eq("id", row.id);
    return error ? { error: error.message } : {};
  }

  if (!clean) return {};

  const { error } = await db.from("contacts").insert({
    company_id: companyId,
    name: person.name,
    title: person.title,
    email: clean,
    name_inferred: false,
    find_status: "found",
    find_source: PERSON_TYPED_SOURCE,
    verification_status: "not_attempted",
  });
  return error ? { error: error.message } : {};
}

export interface LooseEmail {
  id: string;
  email: string;
  source: string | null;
}

/**
 * Addresses at this company that belong to nobody.
 *
 * A row with a name is somebody's; these are what is left. office@ off a
 * footer, billing@ from a domain sweep. They are the front desk until
 * somebody says otherwise, which is what assignEmail is for.
 */
export async function loadUnattached(db: Db, companyId: string): Promise<LooseEmail[]> {
  const { data } = await db
    .from("contacts")
    .select("id, email, find_source, name")
    .eq("company_id", companyId);
  return (data ?? [])
    .filter((c) => c.email && !c.name)
    .map((c) => ({ id: c.id, email: c.email as string, source: c.find_source }));
}

/**
 * Hand a loose address to a person.
 *
 * Jonathan's ask: the sweep at Father & Son returned mattscheff@ and
 * accounting@ with nobody attached, and mattscheff@ is obviously a person the
 * crawler never named. Adding "Matt Scheff" and then retyping his address is
 * two jobs for one fact; this moves the address onto him instead.
 *
 * Because a person IS a contacts row carrying a name, attaching an address is
 * writing that name onto the row it is already in. No copy, no second row, and
 * the address keeps its find_source -- so a bought address still reads as
 * bought after it has been assigned, which is the audit trail.
 */
export async function assignEmail(
  db: Db,
  companyId: string,
  contactId: string,
  person: { name: string; title: string | null }
): Promise<{ error?: string }> {
  const { data: row } = await db
    .from("contacts")
    .select("id, email, name")
    .eq("id", contactId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!row) return { error: "No such address here." };
  if (!row.email) return { error: "That row has no address on it." };

  const people = await loadPeople(db, companyId);
  const existing = people.find(
    (p) => p.name.trim().toLowerCase() === person.name.trim().toLowerCase()
  );
  if (!existing && people.length >= MAX_PEOPLE) {
    return { error: `That is the limit of ${MAX_PEOPLE} people on one company.` };
  }
  if (existing?.email) {
    return { error: `${existing.name} already has ${existing.email}.` };
  }

  const { error } = await db
    .from("contacts")
    .update({ name: person.name, title: person.title })
    .eq("id", contactId);
  if (error) return { error: error.message };

  // A marker row created earlier to say "this person exists" or "look this
  // person up" is now redundant: the address row carries the name. Move its
  // ticked state across first, then remove it, so assigning an address does
  // not silently untick somebody.
  const { data: dupes } = await db
    .from("contacts")
    .select("id, find_source, email")
    .eq("company_id", companyId)
    .ilike("name", person.name)
    .neq("id", contactId);
  for (const d of dupes ?? []) {
    if (d.email) continue;
    if (d.find_source === PERSON_TARGET_SOURCE) {
      await setTarget(db, companyId, person, true);
    }
    await db.from("contacts").delete().eq("id", d.id);
  }
  return {};
}
