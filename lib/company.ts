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
  verificationStatus: VerificationStatus;
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
