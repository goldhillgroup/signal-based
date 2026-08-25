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
  if (fullName) {
    const { ok, data } = await post("/search/person.json", { domain, full_name: fullName });
    if (ok && data?.success && data?.results?.email) {
      recordCost("anymailfinder_lookup");
      return { found: true, email: data.results.email, name: fullName, nameInferred: false };
    }
  }

  if (opts.personOnly) {
    return { found: false, email: null, name: null, nameInferred: false };
  }

  // Fallback: any email at the domain, name inferred from the handle.
  const { ok, data } = await post("/search/company.json", { domain });
  if (ok && data?.success) {
    const emails: string[] = data?.results?.emails ?? [];
    const first = emails[0];
    if (first) {
      recordCost("anymailfinder_lookup");
      return { found: true, email: first, name: inferNameFromEmail(first), nameInferred: true };
    }
  }

  return { found: false, email: null, name: null, nameInferred: false };
}
