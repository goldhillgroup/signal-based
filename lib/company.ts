import { isSharedInbox } from "./pipeline/page-email";
import type {
  Industry,
  CompanyStatus,
  Confidence,
  PageType,
  FindStatus,
  VerificationStatus,
} from "./supabase/types";

/**
 * The client-side shape a `companies` row is mapped into — see mapCompanyRow
 * in lib/searches-store.tsx for the mapping, and lib/supabase/types.ts for the
 * database row it comes from.
 *
 * Previously lived in lib/mock-companies.ts alongside a 659-line fixture of
 * fictional companies. Every one of the eight files importing that module took
 * only these types; the fixture itself had no importers at all and was deleted
 * (2026-08-07). Splitting it out also ends a naming lie — real dashboard code
 * was importing its core type from a file called "mock-".
 */

export interface Evidence {
  quote: string;
  sourceUrl: string;
  pageType: PageType;
  disproveNotes?: string;
}

export interface Contact {
  name: string | null;
  nameInferred: boolean;
  title: string | null;
  email: string | null;
  findStatus: FindStatus;
  /**
   * Where the address came from: "anymailfinder", "reused-known-domain", or
   * "company-page:<kind>" where kind is person_match | person | role |
   * free_mail (see lib/pipeline/page-email.ts).
   *
   * Carried to the client because the local part alone cannot settle who an
   * address reaches. atz5232@aol.com is nobody's name and info@ is nobody's
   * name, but they are different KINDS of nobody: one is the company's own
   * catch-all, the other a screened reception inbox.
   */
  findSource?: string | null;
  verificationStatus: VerificationStatus;
}

/**
 * Does this address reach a PERSON, or the company's front desk?
 *
 * The distinction Daniel asked for, and the one the product turns on. Jonathan
 * opens conversations about handing a family business to a child. office@
 * reaches whoever screens the mail; buddy@ reaches Buddy. Both are worth
 * having and they are not the same lead, so they get their own columns rather
 * than competing for one.
 *
 * A bought address counts as personal: AnymailFinder is asked for a named
 * person. A scraped one counts only when the crawl judged it person_match (it
 * matched the founder's or successor's name) or person (a name-shaped mailbox
 * on the company's own domain).
 */
export function reachesAPerson(c: Contact | null | undefined): boolean {
  if (!c?.email) return false;
  const src = c.findSource ?? "";
  if (src.startsWith("company-page:")) {
    const kind = src.slice("company-page:".length);
    return kind === "person_match" || kind === "person";
  }
  // A bought address whose NAME was inferred came from the domain fallback,
  // not from finding the person. It is still a way in, and it still belongs in
  // the general column rather than being presented as somebody by name.
  if (c.nameInferred) return false;
  // anymailfinder / reused-known-domain, or anything unlabelled that the
  // lookup settled: a named mailbox is what was asked for.
  return c.findStatus === "found" && !isSharedInbox(c.email);
}

/** The address to actually write to, whether it was bought or already on the page. */
export function personalEmail(c: Company): Contact | null {
  for (const cand of [c.contact, c.backupContact]) {
    if (reachesAPerson(cand)) return cand ?? null;
  }
  return null;
}

/**
 * What kind of mailbox this is, in the words Jonathan uses.
 *
 * He asked it outright: with three addresses on a company, which is which?
 * The crawler already knows, because it classified each one while reading the
 * page (see page-email.ts's EmailKind), and was keeping the answer to itself.
 */
export function emailKindLabel(c: Contact): string {
  const src = c.findSource ?? "";
  if (src === "anymailfinder") {
    // nameInferred means the person lookup found nothing and the DOMAIN
    // fallback answered: the address is real, the name attached to it was
    // read off the handle, and it is very often somebody else entirely.
    // Asked for John Turner, this returned doug@turnerandsonsllc.com. Calling
    // that "a named person" would put John's name on Doug's mailbox.
    return c.nameInferred ? "Bought, company address" : "Bought, named person";
  }
  if (src === "reused-known-domain") return "Found earlier for this domain";
  // The domain sweep. These came back with a paid lookup for somebody else at
  // the same company, so "On the page" -- which is what the fallthrough below
  // used to call them -- said the wrong thing about where they came from, and
  // "on the page" is checkable in a way "the vendor listed it" is not.
  if (src === "anymailfinder:also") return "Bought, same lookup";
  if (src === "anymailfinder:also:unmatched") return "Bought, nobody matched";
  if (src === "user:typed") return "Added by you";
  if (src.startsWith("company-page:")) {
    switch (src.slice("company-page:".length)) {
      case "person_match":
        return "Personal, matches the name";
      case "person":
        return "Personal, own domain";
      case "role":
        return "General inbox";
      case "free_mail":
        return "Free mail account";
    }
  }
  // Anything unlabelled predates the sources above and was scraped from the
  // company's own site, which is what that era wrote.
  return "On the page";
}

/**
 * Has a paid lookup already been run for this company and come back empty?
 *
 * The difference between "we have not looked yet" and "we looked and there is
 * nothing", which is the only distinction the Email column can usefully draw
 * when it has no address to print. Showing "after Enrich" against one company
 * and "-" against another, when pressing Find emails would treat them
 * identically, is a difference the reader cannot act on.
 */
export function lookupCameBackEmpty(c: Company): boolean {
  return (
    c.contact?.findStatus === "not_found" || c.backupContact?.findStatus === "not_found"
  );
}

/** The front-desk address, shown alongside rather than instead. */
export function generalEmail(c: Company): Contact | null {
  for (const cand of [c.contact, c.backupContact]) {
    if (cand?.email && !reachesAPerson(cand)) return cand;
  }
  return null;
}

export interface Company {
  id: string;
  /**
   * Which search produced this row. Carried so the combined "All leads" view
   * can be narrowed back down to one search without a second round trip — the
   * same company can legitimately appear under two searches, and dropping the
   * link made "where did this come from?" unanswerable from that page.
   *
   * Optional because rows predating the `searches` table have none. Every row
   * that comes from the database sets it (see mapCompanyRow); undefined and
   * null both mean "not attributable to a search", which the filter treats
   * identically.
   */
  searchId?: string | null;
  domain: string;
  name: string;
  industry: Industry;
  state: string;
  city: string;
  phone: string | null;
  address: string | null;
  revenueBand: string;
  employeeBand: string;
  status: CompanyStatus;
  confidence: Confidence | null;
  rejectionReason: string | null;
  founderName: string | null;
  founderTitle: string | null;
  nextGenName: string | null;
  nextGenTitle: string | null;
  sourceUrl: string | null;
  // Whether a succession signal was actually found — independent of the
  // search's mode. In 'filter' mode this is often false on a perfectly good
  // result (no signal was required); in 'hybrid' it's what results rank on.
  hasSignal: boolean | null;
  discoveryChannel: string | null;
  operatingModel?: string | null;
  firstSeenAt: string;
  lastCrawledAt: string;
  evidence: Evidence | null;
  contact: Contact | null;
  /**
   * The shared inbox, when a NAMED person's address is the primary contact.
   *
   * Both are worth having and they are not the same lead. Jonathan opens
   * conversations about handing a family business to a child — the most
   * personal subject a business owner has. info@ reaches whoever screens the
   * inbox; will@ reaches Will. Keeping only one meant the office address
   * sometimes displaced the founder's, because the primary contact was
   * whichever row the database happened to return first.
   */
  backupContact: Contact | null;
  /** Every address on file for this company, best first. */
  allContacts?: Contact[];
}

/**
 * The contact, but only once the lookup step has actually run.
 *
 * A row still at 'not_attempted' holds an email parked free off the company's
 * own page during classification. It is real, but it has not been checked for
 * deliverability and has not yet been weighed against what AnymailFinder might
 * return. Every surface that shows or scores a contact goes through this, so
 * the folder, the score and the CSV can never disagree about whether a company
 * has one.
 */
export function settledContact(c: Company): Contact | null {
  return c.contact && c.contact.findStatus === "found" ? c.contact : null;
}
