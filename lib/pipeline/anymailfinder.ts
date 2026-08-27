import { resolveSetting } from "../settings";
import { recordCost } from "./cost-tracker";

const BASE = "https://api.anymailfinder.com/v5.0";

// Editable from /dashboard/settings (DB value wins, falls through to the
// env var) — see lib/settings.ts.
async function getApiKey(): Promise<string> {
  const key = await resolveSetting("ANYMAILFINDER_API_KEY", process.env.ANYMAILFINDER_API_KEY);
  if (!key) throw new Error("ANYMAILFINDER_API_KEY is not set");
  return key;
}

export interface ContactFindResult {
  found: boolean;
  email: string | null;
  name: string | null;
  nameInferred: boolean;
  /**
   * Every OTHER address the same paid lookup returned.
   *
   * The vendor hands back a list and we were keeping element zero. Asked about
   * fatherandsonlandscape.com it returned seven of a stated ten -- david@,
   * mattscheff@, buddy@, skip@, billing@, office@, accounting@ -- and skip@ is
   * Skip Orth, the founder this product exists to reach. He was discarded, in
   * a response already paid for, so that david@ could be shown alone.
   *
   * These cost nothing extra. The charge is per lookup, not per address.
   */
  alternates: string[];
}

// Read a plausible first name off an email handle for the fallback case —
// same technique the original proof used ("mike@company.com" -> "Mike").
function inferNameFromEmail(email: string): string | null {
  const local = email.split("@")[0];
  const first = local.split(/[._-]/)[0];
  if (!first || first.length < 2 || /^\d+$/.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

async function post(path: string, body: Record<string, unknown>) {
  const apiKey = await getApiKey();
  // 20s ceiling. There was NO timeout here: enrichment loops over every
  // accepted company, so a single unresponsive lookup stalled the entire run
  // until Next killed the function at maxDuration — turning one slow domain
  // into a whole batch of missing contacts.
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Primary path — a named next-gen leader. Falls back to "any owner/manager
// email at this domain" + email-handle name inference when the page named no
// one (per scope: the Kessler & Sons / "mike@..." case).
//
// COST METERING (see cost-tracker.ts): recorded on a FOUND email, not on the
// attempt. AnymailFinder bills per delivered address and charges nothing when
// a search comes back empty, and the response says which happened — a hit is
// `success` with an actual email in the payload, a miss is a non-2xx with no
// address. Metering attempts would badly overstate this step: plenty of the
// small trade companies in this pipeline have no discoverable email at all,
// and each of those misses would otherwise show up as a $0.05 charge that
// never existed. Both branches below can bill at most once per call, since
// the person lookup returns before the company fallback runs.
// (Price is an ESTIMATE — see UNIT_USD.)
export async function findContact(
  domain: string,
  fullName: string | null,
  opts: {
    /**
     * Refuse the any-address-at-this-domain fallback below.
     *
     * WHY THIS EXISTS. Asked for the founder and then the successor at Turner
     * & Sons, this function returned doug@turnerandsonsllc.com both times, and
     * scavallari@centralmechct.com both times at Central Mechanical. Not a
     * vendor quirk: the person lookup found nothing for one of the two names,
     * the company fallback ran, and a domain-wide address came back reported
     * as a find. Two of two leads that name both generations.
     *
     * For the FIRST person at a company that fallback is the right trade: a
     * general address beats no way in at all. For the second it is worse than
     * nothing. We already hold that address, so the call buys a duplicate at
     * full price and files it under somebody it demonstrably does not belong
     * to, which is a lie the list would carry into an email.
     *
     * With this set the failed person lookup returns not-found and costs
     * nothing, because the vendor bills on a find.
     */
    personOnly?: boolean;
  } = {}
): Promise<ContactFindResult> {
  // NAME TIDYING WAS TRIED HERE AND REMOVED, because it bought nothing.
  //
  // The theory was that a page writes people the way people talk -- John
  // "Hayden" Turner, Bill Madey Jr, Edward R. Dowling Sr. -- while a directory
  // holds "John Turner", so the decoration was costing us matches.
  //
  // Measured against every name in the database that stripping would change
  // (19 of them, 10 tested live): raw found 2, tidied found the same 2, newly
  // found by tidying ZERO. The vendor already normalises suffixes and
  // nicknames. Sending the page's version verbatim is also the safer of the
  // two, since a mailbox can genuinely contain "jr".
  //
  // Passing company_name alongside the domain was tried in the same pass and
  // made no difference to any result either.
  if (fullName) {
    const { ok, data } = await post("/search/person.json", { domain, full_name: fullName });
    if (ok && data?.success && data?.results?.email) {
      recordCost("anymailfinder_lookup");
      return {
        found: true,
        email: data.results.email,
        name: fullName,
        nameInferred: false,
        alternates: cleanEmails(data.results.alternatives, data.results.email),
      };
    }
  }

  if (opts.personOnly) {
    return { found: false, email: null, name: null, nameInferred: false, alternates: [] };
  }

  // Fallback: any email at the domain, name inferred from the handle.
  const { ok, data } = await post("/search/company.json", { domain });
  if (ok && data?.success) {
    const emails: string[] = data?.results?.emails ?? [];
    const first = emails[0];
    if (first) {
      recordCost("anymailfinder_lookup");
      return {
        found: true,
        email: first,
        name: inferNameFromEmail(first),
        nameInferred: true,
        alternates: cleanEmails(emails, first),
      };
    }
  }

  return { found: false, email: null, name: null, nameInferred: false, alternates: [] };
}

/** The list minus the one already taken, deduplicated, sane, and capped. */
function cleanEmails(raw: unknown, exclude: string | null): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const e = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) continue;
    if (exclude && e === exclude.trim().toLowerCase()) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    // Ten addresses on one small company is mostly billing@ and info@ by the
    // tail. Enough to catch the family, not so many that the drawer becomes a
    // mailing list.
    if (out.length >= 9) break;
  }
  return out;
}

/**
 * Every address the vendor holds for a domain, in one call.
 *
 * The company endpoint returns a LIST -- fatherandsonlandscape.com came back
 * with seven of a stated ten, including skip@ for Skip Orth, the founder --
 * and until now it only ran as a fallback when a person lookup found nothing.
 * On a company where the person WAS found, the list was never fetched, so the
 * rest of the family stayed invisible.
 *
 * ONE CHARGE, not one per person. That matters against the alternative: buying
 * per person costs a lookup each and, measured on the two leads that name both
 * generations, returned the SAME address both times. A single sweep is cheaper
 * and returns more.
 */
export async function companyEmails(domain: string): Promise<string[]> {
  const { ok, data } = await post("/search/company.json", { domain });
  if (!ok || !data?.success) return [];
  const emails: unknown = data?.results?.emails;
  if (!Array.isArray(emails) || emails.length === 0) return [];
  recordCost("anymailfinder_lookup");
  return cleanEmails(emails, null);
}
