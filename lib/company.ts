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
