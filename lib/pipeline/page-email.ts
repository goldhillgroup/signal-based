/**
 * Reading an email off the company's own page, as a fallback when the paid
 * lookup comes back empty.
 *
 * On the last real run AnymailFinder found an address for 16 of 27 companies.
 * The other 11 got a `not_found` row and nothing else — a company that passed
 * every gate, that he actually wants to call, with no way to reach it. Most of
 * those sites publish an address in plain text on the page we already read.
 *
 * WHY THIS RUNS AFTER THE PAID LOOKUP, NOT BEFORE
 * AnymailFinder bills $0.05 only when it finds something, so a failed lookup is
 * free. A page crawl is $0.013 and bills whether or not it helps. Scraping
 * first would therefore add $0.013 to every company to avoid a charge that only
 * lands on success, which is close to break-even at best — and it would trade a
 * person-specific address (mmorrill@, marcus.kerske@) for a shared inbox
 * (info@), which is a worse lead for someone whose whole pitch is reaching the
 * founder and the successor by name. Running it second is pure upside: it costs
 * nothing on the 59% that already work, and rescues part of the 41%.
 */

/** Shared inboxes. Real, usable, but clearly not a named person. */
const ROLE_PREFIXES = new Set([
  "info", "contact", "hello", "sales", "office", "admin", "support", "team",
  "enquiries", "inquiries", "mail", "help", "service", "customerservice",
  "estimates", "quotes", "scheduling", "billing", "accounting", "hr", "careers",
  "jobs", "marketing", "webmaster", "noreply", "no-reply", "donotreply",
]);

/**
 * Addresses that belong to the page's plumbing rather than the business.
 * Left in, these get recorded as the owner's contact and he emails a CDN.
 */
const JUNK_DOMAINS = [
  "example.com", "example.org", "domain.com", "yourdomain.com", "email.com",
  "sentry.io", "wix.com", "wixpress.com", "squarespace.com", "godaddy.com",
  "shopify.com", "wordpress.com", "schema.org", "w3.org", "googleapis.com",
  "cloudflare.com", "gravatar.com", "jquery.com", "bootstrapcdn.com",
];

const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "msn.com", "comcast.net", "verizon.net", "att.net",
]);

// Trailing punctuation and image extensions are the two things that actually
// corrupt a scraped address: "sales@acme.com." and "logo@2x.png" both match a
// naive pattern.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|css|js)$/i;

export type EmailKind = "person_match" | "person" | "role" | "free_mail";

export interface FoundEmail {
  email: string;
  kind: EmailKind;
  /** Local part matched a name we were looking for. */
  matchedName: string | null;
}

/** Pull every plausible address out of page text, cleaned and deduped. */
export function extractEmails(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.match(EMAIL_RE) ?? []) {
    const email = raw.toLowerCase().replace(/[.,;:)\]}>'"]+$/, "");
    if (IMAGE_EXT.test(email)) continue;
    const domain = email.split("@")[1] ?? "";
    if (!domain.includes(".")) continue;
    if (JUNK_DOMAINS.some((j) => domain === j || domain.endsWith(`.${j}`))) continue;
    // A local part that is all digits or a single character is nearly always a
    // parsing artifact rather than a mailbox.
    const local = email.split("@")[0] ?? "";
    if (local.length < 2 || /^\d+$/.test(local)) continue;
    out.add(email);
  }
  return [...out];
}

/** Normalized name tokens worth matching a local part against. */
function nameTokens(name: string | null): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

/**
 * Does this local part plausibly belong to `name`?
 *
 * Covers the shapes small-business sites actually use: `will`, `wgreathouse`,
 * `will.greathouse`, `greathousew`. Requires a length-3 token so "a@" or "jo@"
 * cannot match "Joanne" by accident.
 */
function localMatchesName(local: string, name: string): boolean {
  const parts = nameTokens(name);
  if (parts.length === 0) return false;
  const flat = local.replace(/[._-]/g, "");
  const [first, last] = [parts[0], parts[parts.length - 1]];

  if (parts.some((p) => flat === p)) return true; // will
  if (last && first && flat === `${first}${last}`) return true; // willgreathouse
  if (last && first && flat === `${first[0]}${last}`) return true; // wgreathouse
  if (last && first && flat === `${last}${first[0]}`) return true; // greathousew
  if (last && first && flat === `${first}${last[0]}`) return true; // willg
  return false;
}

/**
 * Rank what the page offered and pick the best.
 *
 * Preference order is about who he ends up talking to, not about tidiness:
 * an address belonging to the named successor beats one belonging to anyone,
 * which beats a shared inbox, which beats a personal gmail the business
 * happens to use.
 */
export function bestEmailFor(
  emails: string[],
  companyDomain: string,
  targetNames: (string | null)[]
): FoundEmail | null {
  const names = targetNames.filter((n): n is string => !!n);
  const bare = companyDomain.replace(/^www\./, "").toLowerCase();

  const scored: FoundEmail[] = [];
  for (const email of emails) {
    const [local, domain] = email.split("@");
    const onSite = domain === bare || domain.endsWith(`.${bare}`) || bare.endsWith(`.${domain}`);
    const free = FREE_MAIL.has(domain);
    // An address on someone ELSE's corporate domain is a supplier, a web
    // designer, or an association — not this company.
    if (!onSite && !free) continue;

    const matched = names.find((n) => localMatchesName(local, n)) ?? null;
    const isRole = ROLE_PREFIXES.has(local.replace(/[._-]/g, ""));

    let kind: EmailKind;
    if (matched) kind = "person_match";
    else if (free) kind = "free_mail";
    else if (isRole) kind = "role";
    else kind = "person";

    scored.push({ email, kind, matchedName: matched });
  }

  const order: EmailKind[] = ["person_match", "person", "role", "free_mail"];
  for (const k of order) {
    const hit = scored.find((s) => s.kind === k);
    if (hit) return hit;
  }
  return null;
}
