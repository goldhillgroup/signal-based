/**
 * The OTHER people at a company: co-owners, partners, siblings, the rest of the
 * leadership a page names beyond the founder and the successor.
 *
 * WHY THIS EXISTS. Jonathan, 2026-10-13: "Signal Radar isn't consistently
 * capturing co-owners, even when their contact information is available. For
 * many companies the primary owner's email is not available, but a co-owner's
 * email is. Since those contacts are not being included, we are potentially
 * missing qualified, reachable prospects."
 *
 * Four separate gaps, all of which made that true:
 *
 *   1. The classifier returned exactly two people, founderName and nextGenName.
 *      A page naming three brothers who own it together, or a husband-and-wife
 *      pair, or a managing partner beside the founder, produced two names and
 *      dropped the rest (the siblings landed as free text in `otherSignals`).
 *   2. Enrichment bought an address for ONE person and, when that came back
 *      empty, recorded "not found" and settled the company for good. Nobody
 *      else listed there was ever tried, even though the vendor only bills when
 *      it FINDS something, so trying them costs nothing unless it works.
 *   3. Page emails were matched to the founder and the successor only. An
 *      address sitting beside a co-owner's name on the team page was filed as
 *      an anonymous inbox, and on promotion every parked address took the
 *      verification result of just one of them.
 *   4. Even when several people had addresses, the list, the cards and the
 *      exports each showed ONE personal contact per company.
 *
 * This file is gap 1, and the shared vocabulary for gaps 2 to 4.
 */

import { callableName, cleanPersonName, cleanTitle } from "../lead-signal";

/** A person the crawler read off the page. `find_source` on their contacts row. */
export const PAGE_PERSON_SOURCE = "page:person";

/**
 * How many the crawler will record, beyond the founder and the successor.
 * A team page can list thirty people; this is about leadership, and an owner
 * list longer than this is a staff directory.
 */
export const MAX_PAGE_PEOPLE = 4;

export interface PagePerson {
  name: string;
  title: string | null;
  /** How the page relates them to the others ("brother of Tom", "co-owner"). */
  relationship: string | null;
}

/**
 * WHO BELONGS ON THIS LIST: people who OWN the company, are FAMILY of the
 * people who do, or run it as an executive. Not everyone with "manager" in their
 * title.
 *
 * Found by running the real classifier on a realistic page, 2026-10-13: told to
 * leave out "crew, technicians, office staff", the model still returned a
 * dispatcher, a crew leader and an Operations Manager from a page that listed
 * them under "Staff". The first two were caught by a list of staff words; the
 * third was not, and a list of staff words can never be finished (project
 * manager, superintendent, foreman, estimator, bookkeeper...). So the net is
 * turned the other way round: a person is kept only if their title says they own
 * or lead the business, or the page ties them to the family. That is also all
 * this list is for: finding more owners to write to.
 *
 * "Director" is in because family firms use it for the people who run a function
 * ("Director of Design"); "Executive" is deliberately NOT, because it is also an
 * "Account Executive" in sales.
 */
const OWNER_LEVEL =
  /\b(owner|co-?owner|proprietor|principal|partner|founder|co-?founder|president|vice[- ]president|v\.?p\.?|chair(?:man|woman|person)?|ceo|coo|cfo|chief (?:executive|operating|financial) officer|general manager|managing (?:director|member|partner)|director)\b/i;

/**
 * People the page speaks of as gone. Found on a real backfill run: a company's
 * history section names the founder and his sons, and the model listed them all
 * as people to reach. The prompt now says "involved now", and this is the net
 * under it for the plain cases ("the late Ralph Sr.", "in memory of").
 */
const GONE = /\b(the late|late founder|deceased|passed away|passed on|in (?:loving )?memory|memorial|rest in peace|r\.?i\.?p\.?)\b/i;

/** How the page ties them to the owners. Enough on its own, whatever their job. */
const FAMILY =
  /\b(wife|husband|spouse|son|daughter|brother|sister|sibling|father|mother|dad|mom|nephew|niece|cousin|uncle|aunt|grandson|granddaughter|grandfather|grandmother|in-law|child|children|relative|family|co-?owner|partner)\b/i;

/**
 * Sanitise what the model returned.
 *
 * Only names a person could actually look up and ring (the same test the
 * founder and successor must pass), no duplicates of each other or of the two
 * people already recorded, only owners, executives and family (see OWNER_LEVEL),
 * and no more than MAX_PAGE_PEOPLE. Anything malformed is dropped rather than
 * repaired: a missing co-owner is a missing field, a wrong one is a wrong name in
 * a cold email.
 */
export function cleanOtherPeople(raw: unknown, alreadyKnown: (string | null | undefined)[]): PagePerson[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  for (const k of alreadyKnown) {
    const n = key(k);
    if (n) seen.add(n);
  }

  const out: PagePerson[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    const name = cleanPersonName(typeof rec.name === "string" ? rec.name : null);
    if (!name || !callableName(name)) continue;

    const k = key(name);
    if (!k || seen.has(k)) continue;
    // "Tom Smith" and "Tom Smith Jr." are two people; "Thomas" and "Tom" are
    // not provably one, so only an exact (normalised) match is treated as a dupe.

    const title = cleanTitle(typeof rec.title === "string" ? rec.title : null);
    const relationship =
      typeof rec.relationship === "string" && rec.relationship.trim()
        ? rec.relationship.trim().slice(0, 80)
        : null;

    // An owner, an executive, or family. A relative in an ordinary job (a nephew
    // who is a crew leader) stays, because the family is the point; an employee
    // who is neither does not, however senior the page makes them sound.
    const ownerLevel = !!title && OWNER_LEVEL.test(title);
    const family = !!relationship && FAMILY.test(relationship);
    if (!ownerLevel && !family) continue;
    // Gone is not a contact.
    if (GONE.test(`${title ?? ""} ${relationship ?? ""} ${name}`)) continue;

    seen.add(k);
    out.push({ name, title, relationship });
    if (out.length >= MAX_PAGE_PEOPLE) break;
  }
  return out;
}

function key(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The title that belongs to whoever an address was matched to.
 *
 * Parked page emails used to take `nextGenTitle ?? founderTitle` whatever name
 * had matched, so a co-owner's address was filed under the successor's title.
 */
export function titleFor(
  matchedName: string | null | undefined,
  roster: { name: string | null | undefined; title: string | null | undefined }[]
): string | null {
  const m = key(matchedName);
  if (!m) return null;
  for (const p of roster) {
    if (key(p.name) === m) return p.title ?? null;
  }
  return null;
}
