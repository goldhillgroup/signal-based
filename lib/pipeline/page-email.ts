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

/**
 * Everything the page offered, best first, instead of only the winner.
 *
 * bestEmailFor answers "which one should we use", which is the right question
 * for picking an enrichment target and the wrong one for what to KEEP. A
 * contractor's About page routinely prints office@, the owner's own address
 * and a gmail the crew uses, and the crawler was storing one and discarding
 * the other two. Across every lead in the database not one company had more
 * than a single address on file, which is not what those pages say.
 *
 * They are different things and Jonathan reads them differently: office@ is
 * the front desk, will@ is Will, and the gmail is often the number he actually
 * gets answered on. Keeping one and silently binning the rest decided for him.
 *
 * Same ranking, so callers that want the single best still take [0].
 */
export function allEmailsFor(
  emails: string[],
  companyDomain: string,
  targetNames: (string | null)[]
): FoundEmail[] {
  const best = bestEmailFor(emails, companyDomain, targetNames);
  if (!best) return [];
  const order: EmailKind[] = ["person_match", "person", "role", "free_mail"];
  const seen = new Set<string>();
  const out: FoundEmail[] = [];
  // bestEmailFor already did the filtering and scoring; re-run it over the
  // remainder rather than duplicating the rules here, so the two can never
  // disagree about what counts as a usable address.
  let pool = emails;
  for (let guard = 0; guard < 12; guard++) {
    const next = bestEmailFor(pool, companyDomain, targetNames);
    if (!next || seen.has(next.email)) break;
    seen.add(next.email);
    out.push(next);
    pool = pool.filter((e) => e.toLowerCase() !== next.email.toLowerCase());
  }
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/**
 * Is this address a shared inbox rather than a person?
 *
 * Judged on the local part, not on where the address came from, because the
 * source does not settle it: AnymailFinder usually returns a named mailbox but
 * can return info@, and a page scrape usually returns info@ but can return the
 * founder's own address. The mailbox name is the fact.
 *
 * It matters because of what this product is FOR. Jonathan opens conversations
 * about handing a family business to a child — the most personal subject a
 * business owner has. info@ reaches whoever screens the inbox; will@ reaches
 * Will. Both are worth having and they are not the same lead.
 */
export function isSharedInbox(email: string | null | undefined): boolean {
  if (!email) return false;
  const local = email.split("@")[0]?.toLowerCase().replace(/[._-]/g, "") ?? "";
  return ROLE_PREFIXES.has(local);
}

// ─────────────────────────────────────────────────────────────────────────
// PHONE NUMBERS
//
// Same idea as the email scrape above, and the same economics: the page has
// already been fetched and paid for, so reading a phone number off it is free.
//
// It matters more than it looks. Phone and address arrive with Google Places
// for companies found through Maps, and Maps is the LOW-signal channel — 0.9
// confirmed pairs per 100 companies read against web search's 4.8. So the
// leads most worth calling were exactly the ones with no number: measured
// across 236 qualified leads, maps had a phone for 81% and web_search for 0%.
//
// And for a founder in his sixties running a landscaping company, the phone is
// often the contact that actually gets answered.
// ─────────────────────────────────────────────────────────────────────────

/**
 * US phone numbers, written the way small business sites write them:
 * (555) 123-4567, 555-123-4567, 555.123.4567, +1 555 123 4567.
 *
 * Anchored on both sides against a longer digit run, so a 16-digit tracking
 * ID, an EIN or a licence number cannot masquerade as a number to call.
 */
const US_PHONE_RE =
  /(?<!\d)(?:\+?1[\s.\-]?)?(?:\((\d{3})\)|(\d{3}))[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)/g;

/** Area codes and exchanges that are never a real business line. */
function plausible(digits: string): boolean {
  if (digits.length !== 10) return false;
  const area = digits.slice(0, 3);
  const exch = digits.slice(3, 6);
  // NANP: neither area code nor exchange may begin with 0 or 1.
  if (/^[01]/.test(area) || /^[01]/.test(exch)) return false;
  // 555-01xx is the reserved fictional range, and a run of one digit
  // (0000000000, 1111111111) is a placeholder someone forgot to replace.
  if (exch === "555") return false;
  if (/^(\d)\1{9}$/.test(digits)) return false;
  // Sequential filler: 1234567890.
  if (digits === "1234567890" || digits === "0123456789") return false;
  return true;
}

export function extractPhones(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(US_PHONE_RE)) {
    const digits = `${m[1] ?? m[2]}${m[3]}${m[4]}`;
    if (plausible(digits)) seen.add(digits);
  }
  return [...seen];
}

/** `5551234567` -> `(555) 123-4567`. One format everywhere, so the column
 *  sorts and reads consistently however the site happened to write it. */
export function formatPhone(digits: string): string {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * The number most likely to be the company's main line.
 *
 * A page can carry several — a mobile, a fax, an emergency line, the web
 * designer's. Preference goes to one the page explicitly labels as somewhere
 * to call, then to whichever appears most often, which on a small business
 * site is almost always the header/footer number repeated on every page.
 */
export function bestPhoneFor(text: string): string | null {
  const found = extractPhones(text);
  if (found.length === 0) return null;

  // No early return for the single-number case. That shortcut skipped the
  // labelling pass below, so a page whose only number was a FAX line returned
  // the fax as the number to call — the one result here that is actively
  // wrong rather than merely unhelpful.
  const counts = new Map<string, number>();
  const labelled = new Set<string>();
  for (const m of text.matchAll(US_PHONE_RE)) {
    const digits = `${m[1] ?? m[2]}${m[3]}${m[4]}`;
    if (!plausible(digits)) continue;
    counts.set(digits, (counts.get(digits) ?? 0) + 1);
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0).toLowerCase();
    if (/\b(call|phone|tel|telephone|office|contact|dial)\b/.test(before)) labelled.add(digits);
    // A fax number is the one thing here that is actively wrong to call.
    if (/\bfax\b/.test(before)) counts.set(digits, -1);
  }
  const ranked = found
    .filter((d) => (counts.get(d) ?? 0) >= 0)
    .sort(
      (a, b) =>
        Number(labelled.has(b)) - Number(labelled.has(a)) ||
        (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
    );
  return ranked[0] ? formatPhone(ranked[0]) : null;
}
