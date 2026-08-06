import type { Industry } from "../supabase/types";
import { stateNameFor } from "./us-states";
import { resolveSetting } from "../settings";
// Circular by module graph (directory-discovery imports hostnameOf/isBlocked/
// fetchSingleUrl from here), but safe: every binding on both sides is used
// only inside function bodies at call time, never at module-evaluation time,
// so neither module needs the other to be fully initialized when it loads.
import { discoverViaDirectories } from "./directory-discovery";
import { firecrawlScrape } from "./firecrawl";

// Prefers APIFY_TOKEN_4, then _3, _2, then the primary APIFY_TOKEN — keeps
// test-run cost off Jonathan's account during development. _2 ran dry
// testing actor schemas, _3 ran dry live-testing (both $5/mo free-tier
// accounts, see .env.local for reset dates); _4 is the current one. Editable
// from /dashboard/settings (DB value wins); each falls through to its own
// env var when unset in Settings — see lib/settings.ts.
async function getApifyToken(): Promise<{ token: string; isToken4: boolean }> {
  const [t4, t3, t2, t1] = await Promise.all([
    resolveSetting("APIFY_TOKEN_4", process.env.APIFY_TOKEN_4),
    resolveSetting("APIFY_TOKEN_3", process.env.APIFY_TOKEN_3),
    resolveSetting("APIFY_TOKEN_2", process.env.APIFY_TOKEN_2),
    resolveSetting("APIFY_TOKEN", process.env.APIFY_TOKEN),
  ]);
  if (t4) return { token: t4, isToken4: true };
  const token = t3 || t2 || t1;
  if (!token) throw new Error("APIFY_TOKEN is not set");
  return { token, isToken4: false };
}
const APIFY_BASE = "https://api.apify.com/v2";

// Self-imposed spending cap — ONLY for token 4 (info@frydai.ai, a $29/mo
// plan Apify's API refused to lower: "cannot be less than 29"). The other
// tokens are $5/mo free-tier accounts already hard-capped by Apify itself;
// this guard is specifically to keep this one account's real $29 ceiling
// from ever being used past $5 by this app, not a generic cap on every token.
const BUDGET_CAP_USD = 5;
const BUDGET_CHECK_TTL_MS = 15_000; // avoid hammering /limits on a burst of concurrent fetch calls
let budgetCache: { usedUsd: number; checkedAt: number } | null = null;

async function assertUnderBudget(token: string) {
  const now = Date.now();
  if (!budgetCache || now - budgetCache.checkedAt > BUDGET_CHECK_TTL_MS) {
    const res = await fetch(`${APIFY_BASE}/users/me/limits?token=${token}`);
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const usedUsd = body?.data?.current?.monthlyUsageUsd;
      if (typeof usedUsd === "number") budgetCache = { usedUsd, checkedAt: now };
    }
    // A failed limits check doesn't block the run — this is a spending
    // guard, not the primary error path; an outage here shouldn't be why a
    // search fails.
  }
  if (budgetCache && budgetCache.usedUsd >= BUDGET_CAP_USD) {
    throw new Error(
      `Apify self-imposed budget cap hit: this account has used $${budgetCache.usedUsd.toFixed(2)} this cycle (cap: $${BUDGET_CAP_USD}). Raise BUDGET_CAP_USD in lib/pipeline/apify.ts or switch tokens to continue.`
    );
  }
}

// Vertical-specific Google Maps category searches — matches the two
// verticals in the signed scope (family-owned landscaping + home builders).
// Real-world terms a business would actually list itself under on its
// Google Business Profile, not generic marketing phrasing.
// Covers each vertical's whole trade family, not one narrow category — the
// client's own reference list counted tree service and irrigation companies
// as in-scope landscaping leads (see openrouter.ts's CLASSIFY_SYSTEM for the
// full reasoning). Maps categorizes fairly strictly, so a "landscaping
// company" search alone genuinely does NOT surface tree services; they need
// their own terms. Cost stays flat as terms are added — see the per-round
// place budget in discoverViaMaps rather than a fixed per-term count.
const VERTICAL_SEARCH_TERMS: Record<Industry, string[]> = {
  landscaping: [
    "landscaping company",
    "lawn care company",
    "landscape design company",
    "tree service company",
    "irrigation contractor",
  ],
  home_builder: [
    "custom home builder",
    "general contractor",
    "home construction company",
    "design build remodeler",
  ],
};

function searchTermsFor(industry: Industry | null): string[] {
  if (industry) return VERTICAL_SEARCH_TERMS[industry];
  return [...VERTICAL_SEARCH_TERMS.landscaping, ...VERTICAL_SEARCH_TERMS.home_builder];
}

// Directories/aggregators/socials — never the company's own site, so the
// scope's "read the company's own About/Team/Leadership page" test can't
// apply. Filtered out of discovery results before they ever reach a fetch.
const BLOCKED_HOSTS = [
  "facebook.com",
  "linkedin.com",
  "instagram.com",
  "yelp.com",
  "houzz.com",
  "angi.com",
  "angieslist.com",
  "thumbtack.com",
  "bbb.org",
  "indeed.com",
  "glassdoor.com",
  "wikipedia.org",
  "youtube.com",
  "yellowpages.com",
  "manta.com",
  "nextdoor.com",
  "porch.com",
  "homeadvisor.com",
  "buildzoom.com",
  "zillow.com",
  "google.com",
  "maps.google.com",
];

export interface Candidate {
  domain: string;
  url: string;
  title: string;
  channel: "maps" | "web_search" | "directory";
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isBlocked(host: string): boolean {
  return BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));
}

async function runActorSync(actorId: string, input: Record<string, unknown>, timeoutSecs = 120) {
  const { token, isToken4 } = await getApifyToken();
  if (isToken4) await assertUnderBudget(token);
  const res = await fetch(
    `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Apify actor ${actorId} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

// "Best landscaping companies in X," "Top 10 home builders" — directory/
// roundup articles that show up in web search results alongside real company
// sites. Never the company's own site, so filter on title before a single
// Apify or OpenRouter call is spent on one.
function isListicleTitle(title: string | undefined): boolean {
  if (!title) return false;
  return /\b(best|top\s*\d+|\d+\s*best|reviews?)\b/i.test(title);
}

// Channel A — Google Maps Scraper (compass/crawler-google-places), searched
// by vertical category terms against one state. Broad, cheap, near-zero
// noise (every result is a real local business in the right category) —
// but undifferentiated: it has no idea what a succession signal is, so it
// surfaces the whole category, not the companies actually likely to show one.
async function discoverViaMaps(
  industry: Industry | null,
  states: string[],
  limit: number,
  round: number
): Promise<Candidate[]> {
  const searchTerms = searchTermsFor(industry);
  const locationQuery = states.length > 0 ? `${stateNameFor(states[0])}, USA` : "United States";
  // Budget places per ROUND, then split across however many terms there are —
  // rather than a fixed count per term, which silently multiplied Apify cost
  // every time a term was added (this actor bills per place scraped, and the
  // round's `limit` cut happens afterward, so extra places are paid for
  // whether or not they're used). Widening trade coverage is now free.
  const roundPlaceBudget = Math.min(60 * round, 360);
  const perTerm = Math.max(10, Math.floor(roundPlaceBudget / searchTerms.length));
  const timeoutSecs = Math.min(280, 60 + perTerm * searchTerms.length * 1.5);

  const items = (await runActorSync(
    "compass~crawler-google-places",
    {
      searchStringsArray: searchTerms,
      locationQuery,
      maxCrawledPlacesPerSearch: perTerm,
      language: "en",
      skipClosedPlaces: true,
    },
    timeoutSecs
  )) as Array<{ title?: string; website?: string | null; categoryName?: string }>;

  return items
    .filter((place) => place.website)
    .map((place) => ({ domain: "", url: place.website!, title: place.title ?? "", channel: "maps" as const }));
}

// Vertical-specific succession-language phrasings — the point of this
// channel isn't category coverage (Maps already has that), it's precision:
// surfacing companies whose own site or local press already uses the
// language of a real handoff, which a generic category listing can't do.
// Adjacent trades folded in via OR rather than as extra queries — this actor
// bills per SERP page, so covering tree service / irrigation / remodelers
// this way widens the trade family without increasing the query count.
const SUCCESSION_QUERY_TERMS: Record<Industry, string[]> = {
  landscaping: [
    '"second generation" family owned landscaping OR "tree service" company',
    '"family owned" landscaping OR irrigation company "joined the business"',
    'father son landscaping OR "tree service" company "family business"',
  ],
  home_builder: [
    '"second generation" family owned home builder OR remodeler',
    '"family owned" custom home builder OR "general contractor" "joined the business"',
    'father son home builder OR remodeler "family business"',
  ],
};

function successionTermsFor(industry: Industry | null): string[] {
  if (industry) return SUCCESSION_QUERY_TERMS[industry];
  return [...SUCCESSION_QUERY_TERMS.landscaping, ...SUCCESSION_QUERY_TERMS.home_builder];
}

// Channel B — targeted web search (apify/google-search-scraper) for
// succession-specific phrasing. Lower yield than Maps (this is raw web
// search, not a curated business index — listicles/directories/trade press
// show up alongside real hits) but catches companies a generic category
// search would never surface: local news features, "family business of the
// year" pieces, a company's own press page. isListicleTitle + BLOCKED_HOSTS
// filter the obvious noise; the classifier's own "not actually a company"
// check (see project memory) catches the rest at ~$0.01-0.02/candidate.
async function discoverViaWebSearch(
  industry: Industry | null,
  states: string[],
  limit: number
): Promise<Candidate[]> {
  const stateName = states.length > 0 ? stateNameFor(states[0]) : "";
  const queries = successionTermsFor(industry)
    .map((q) => `${q} ${stateName}`.trim())
    .join("\n");

  const items = (await runActorSync(
    "apify~google-search-scraper",
    {
      queries,
      resultsPerPage: 100,
      maxPagesPerQuery: 1,
      countryCode: "us",
      languageCode: "en",
    },
    90
  )) as Array<{ organicResults?: Array<{ url: string; title: string }> }>;

  return items
    .flatMap((page) => page.organicResults ?? [])
    .filter((r) => !isListicleTitle(r.title))
    .slice(0, limit)
    .map((r) => ({ domain: "", url: r.url, title: r.title ?? "", channel: "web_search" as const }));
}

// Step 1 — discovery. THREE channels run in parallel and get merged:
//   - directory (lib/pipeline/directory-discovery.ts) — highest-yield per the
//     Ofer Lieberson lesson, Claude+OpenRouter not Apify, gets cheaper over
//     time via the directory_sources cache. Listed FIRST so its candidates
//     win the `limit` cut when channels overlap.
//   - web search — succession-specific phrasing, precision play.
//   - Maps — broad category coverage, but the most Apify-expensive; kept as
//     the volume backstop rather than the primary source now.
// Promise.allSettled — one channel timing out or erroring must not take the
// others' real results down with it (a real Maps timeout happened live during
// testing; a round should degrade to the surviving channels' results rather
// than fail outright over an unrelated channel's hiccup).
export async function discoverCandidates(params: {
  industry: Industry | null;
  states: string[];
  limit: number;
  round?: number; // 1-indexed — later rounds ask Maps for more places per
  // term so a repeat call surfaces businesses beyond what earlier rounds
  // already returned, rather than re-fetching the same top-ranked set.
  excludeDomains?: Set<string>;
}): Promise<{ candidates: Candidate[]; exhausted: boolean; channelErrors: string[] }> {
  const { industry, states, limit, round = 1, excludeDomains } = params;

  const [dirResult, webResult, mapsResult] = await Promise.allSettled([
    discoverViaDirectories(industry, states, limit),
    discoverViaWebSearch(industry, states, limit),
    discoverViaMaps(industry, states, limit, round),
  ]);

  const channelErrors: string[] = [];
  const raw: Candidate[] = [];
  if (dirResult.status === "fulfilled") raw.push(...dirResult.value);
  else channelErrors.push(`Directory channel failed: ${dirResult.reason?.message?.slice(0, 150) ?? dirResult.reason}`);
  if (webResult.status === "fulfilled") raw.push(...webResult.value);
  else channelErrors.push(`Web search channel failed: ${webResult.reason?.message?.slice(0, 150) ?? webResult.reason}`);
  if (mapsResult.status === "fulfilled") raw.push(...mapsResult.value);
  else channelErrors.push(`Maps channel failed: ${mapsResult.reason?.message?.slice(0, 150) ?? mapsResult.reason}`);

  if (
    dirResult.status === "rejected" &&
    webResult.status === "rejected" &&
    mapsResult.status === "rejected"
  ) {
    throw new Error(channelErrors.join(" | "));
  }

  const seen = new Set<string>(excludeDomains ?? []);
  const candidates: Candidate[] = [];
  for (const r of raw) {
    const host = hostnameOf(r.url);
    if (!host || isBlocked(host) || seen.has(host)) continue;
    seen.add(host);
    candidates.push({ domain: host, url: r.url, title: r.title || host, channel: r.channel });
    if (candidates.length >= limit) break;
  }

  // "Exhausted" — this round surfaced fewer fresh domains than asked for,
  // meaning all three channels combined have nothing left to give for this
  // category+state; the caller should stop looping rather than
  // re-requesting a near-empty result set.
  const exhausted = candidates.length < limit;
  return { candidates, exhausted, channelErrors };
}

export interface FetchedPage {
  domain: string;
  url: string;
  text: string;
  siteName: string | null; // og:site_name — the cleanest source for the real company name
}

// Fetches one arbitrary, already-known URL (not a company's guessed
// About-page slugs — a specific directory/listing page). Used by
// directory-discovery.ts's cache-hit path: once a directory URL is known,
// re-fetching it directly is cheap (this) vs. the expensive web-search call
// that found it the first time.
export async function fetchSingleUrl(url: string): Promise<string | null> {
  let items: RawFetchedItem[];
  try {
    items = (await runActorSync(
      "apify~website-content-crawler",
      {
        startUrls: [{ url }],
        crawlerType: "cheerio",
        maxCrawlDepth: 0,
        maxCrawlPages: 1,
        maxRequestRetries: 1,
        saveMarkdown: false,
      },
      45
    )) as RawFetchedItem[];
  } catch {
    return null;
  }
  const item = items[0];
  if (!item?.text || item.text.trim().length < 50) return null;
  if (item.crawl?.httpStatusCode && item.crawl.httpStatusCode !== 200) return null;
  return item.text;
}

// Trimmed to the 5 slugs that actually accounted for every real hit across
// testing (see project memory) — the dropped ones (our-team, leadership,
// who-we-are) never won pickBestPage() once but still cost a full request
// per domain. Fewer guesses per domain keeps each round's fetch actor run
// safely inside its timeout as ROUND_SIZE scales up.
const ABOUT_SLUGS = ["", "about", "about-us", "team", "our-story"];

type RawFetchedItem = {
  url: string;
  text?: string;
  crawl?: { httpStatusCode?: number };
  metadata?: { openGraph?: Array<{ property: string; content: string }> };
};

// Follow ONE hop from the seeded pages to team/leadership pages that live at
// paths flat slug-guessing can never reach. This closes a real, measured
// miss: a research pass qualified Russell Landscape Group off
// `/about-us/our-team/` (founder + next-gen both named there), while this
// pipeline had REJECTED the same company as "no page could be fetched" —
// its evidence page is nested one level below /about-us, so no flat guess
// list would ever find it. Since "two generations named on the company's own
// team page" is the single criterion the whole product turns on, not
// reaching team pages was the most expensive gap in the fetch step.
const TEAM_PAGE_GLOBS = [
  "**/team**",
  "**/our-team**",
  "**/meet**",
  "**/leadership**",
  "**/staff**",
  "**/about/**",
  "**/about-us/**",
  "**/who-we-are**",
  "**/our-story**",
  "**/our-family**",
];

// One domain: 5 seeded URL guesses plus a single hop to any team-ish page
// they link to, in one small actor call with a fixed, predictable timeout.
// Failure here (that domain's site hangs/times out) only costs that one
// domain — never the batch.
async function fetchOneDomain(domain: string): Promise<RawFetchedItem[]> {
  const startUrls = ABOUT_SLUGS.map((slug) => ({ url: `https://${domain}/${slug}` }));
  return (await runActorSync(
    "apify~website-content-crawler",
    {
      startUrls,
      crawlerType: "cheerio",
      // depth 1 + globs: follow links, but ONLY to team/leadership-shaped
      // URLs, so this never turns into a general site crawl. maxCrawlPages
      // is the hard ceiling on what that hop can cost.
      maxCrawlDepth: 1,
      includeUrlGlobs: TEAM_PAGE_GLOBS.map((glob) => ({ glob: `https://${domain}${glob}` })),
      maxCrawlPages: startUrls.length + 5,
      maxRequestRetries: 1,
      saveMarkdown: false,
    },
    90 // raised from 60 — one hop means up to 5 more pages per domain.
  )) as RawFetchedItem[];
}

// Runs `tasks` with at most `limit` in flight at once — a plain concurrency
// pool, no new dependency. Apify allows up to 25 concurrent actor jobs on
// this account; 6 stays well clear of that while still fetching a round's
// domains in parallel instead of one shared serial-ish batch.
async function withConcurrency<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await run(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Step 2 — page fetch. Guesses the common About/Team/Leadership URL slugs per
// domain (maxCrawlDepth 0 — no link-following, so 404s on guessed slugs are
// cheap) and fetches each domain's 5 URLs as its OWN actor call, run with
// bounded concurrency — not one actor call for the whole round's domains.
// Real failure mode this replaces: one shared 75-URL batch behind a single
// timeout meant a couple of slow/hanging domains could sink 70+ perfectly
// fine URLs along with them (reproduced live — see project memory). Now a
// slow domain only ever loses itself.
const FETCH_CONCURRENCY = 6;

// ── Free path: plain fetch + regex extraction, no Apify, no cost ──────────
// The fetch step touches EVERY discovered company, so it's the single
// largest Apify line item — bigger than discovery now that the directory
// channel carries most of the candidates. Most small-trade-business sites
// are plain server-rendered HTML that a bare fetch() handles fine, so the
// paid crawler is only genuinely needed for the JS-rendered / bot-blocking
// minority. Try free first, fall back to Apify per-domain.
const FREE_FETCH_TIMEOUT_MS = 8000;
const FREE_FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function ogSiteNameFrom(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  return m?.[1] ?? null;
}

async function freeFetchOne(
  url: string
): Promise<{ page: FetchedPage; teamLinks: string[] } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": FREE_FETCH_UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(FREE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;
    const html = await res.text();
    const text = htmlToText(html);
    // A JS-rendered shell yields almost no text — treat that as a miss so the
    // Apify fallback (which renders) gets its turn, rather than passing an
    // empty page to an expensive classify call.
    if (text.length < 400) return null;
    const host = hostnameOf(res.url) ?? hostnameOf(url);
    if (!host) return null;
    return {
      page: { domain: host, url: res.url || url, text, siteName: ogSiteNameFrom(html) },
      teamLinks: extractTeamLinks(html, res.url || url),
    };
  } catch {
    return null;
  }
}

// The free path has to do its own one-hop link following, or it would silently
// undo the nested-team-page fix above: a domain whose /about fetches fine for
// free would return that page and never reach /about-us/our-team/, which is
// exactly the evidence page the whole product depends on.
function extractTeamLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    const href = m[1];
    if (!TEAM_URL_RE.test(href)) continue;
    try {
      const abs = new URL(href, baseUrl);
      if (hostnameOf(abs.href) !== hostnameOf(baseUrl)) continue; // same site only
      out.add(abs.href);
    } catch {
      // malformed href — skip
    }
  }
  return Array.from(out).slice(0, 3);
}

// Tries the seeded slugs for free, then one free hop to any team pages they
// link to. Returns null when the free path produced nothing usable, so the
// caller knows to fall back to Apify.
async function freeFetchDomain(domain: string): Promise<FetchedPage[] | null> {
  const seeded = await Promise.all(
    ABOUT_SLUGS.map((slug) => freeFetchOne(`https://${domain}/${slug}`))
  );
  const hits = seeded.filter((r): r is { page: FetchedPage; teamLinks: string[] } => r !== null);
  if (hits.length === 0) return null;

  // Dedupe by FINAL url — different seeded slugs routinely redirect to the
  // same page (/about -> /about-us/), and a duplicate costs a wasted classify
  // token budget for no new information.
  const pages: FetchedPage[] = [];
  const seenUrls = new Set<string>();
  for (const h of hits) {
    if (seenUrls.has(h.page.url)) continue;
    seenUrls.add(h.page.url);
    pages.push(h.page);
  }
  const teamUrls = Array.from(new Set(hits.flatMap((h) => h.teamLinks))).filter(
    (u) => !seenUrls.has(u)
  );

  const followed = await Promise.all(teamUrls.slice(0, 3).map((u) => freeFetchOne(u)));
  followed.forEach((r) => {
    if (r) pages.push(r.page);
  });
  return pages;
}

export async function fetchCompanyPages(domains: string[]): Promise<Map<string, FetchedPage[]>> {
  // Fail loud on real misconfiguration (e.g. missing token) before the
  // per-domain try/catch below has a chance to swallow it as "this domain's
  // site didn't load" — that per-domain tolerance is for individual site
  // failures, not for "nothing can fetch anything."
  await getApifyToken();

  const byDomain = new Map<string, FetchedPage[]>();

  await withConcurrency(domains, FETCH_CONCURRENCY, async (domain) => {
    // LAYER 1 — free plain fetch. Costs nothing and handles the plain-HTML
    // majority: two consecutive live runs got 15/15 and 24/24 this way.
    const free = await freeFetchDomain(domain);
    if (free) {
      byDomain.set(domain, free);
      return;
    }

    // LAYER 2 — Firecrawl. Renders the JS-gated / bot-blocked minority that
    // layer 1 structurally cannot read. Tried BEFORE Apify because it's a
    // plain REST call with no actor-run semantics, no per-actor timeout
    // tuning, and no shared budget cap that can wedge the whole pipeline.
    const rendered = await firecrawlScrape(`https://${domain}/about`).catch(() => null);
    const renderedHome = rendered ?? (await firecrawlScrape(`https://${domain}`).catch(() => null));
    if (renderedHome) {
      byDomain.set(domain, [
        { domain, url: `https://${domain}`, text: renderedHome, siteName: null },
      ]);
      return;
    }

    // LAYER 3 — Apify's rendering crawler. Last resort: it's the layer most
    // likely to be unavailable (budget cap, actor timeout), which is exactly
    // why it's no longer the only fallback.
    let items: RawFetchedItem[];
    try {
      items = await fetchOneDomain(domain);
    } catch {
      // Every layer failed for this domain — it just yields no pages (classify
      // records it as "no page fetched"); everyone else in the round is
      // unaffected.
      return;
    }

    for (const item of items) {
      const host = hostnameOf(item.url);
      // Drop anything that didn't actually load — a 404's boilerplate nav/
      // footer text is often >50 chars and would otherwise sail through to
      // an LLM call that can only ever conclude "no content here."
      if (!host || !item.text || item.text.trim().length < 50) continue;
      if (item.crawl?.httpStatusCode && item.crawl.httpStatusCode !== 200) continue;
      const siteName =
        item.metadata?.openGraph?.find((og) => og.property === "og:site_name")?.content ?? null;
      const list = byDomain.get(host) ?? [];
      list.push({ domain: host, url: item.url, text: item.text, siteName });
      byDomain.set(host, list);
    }
  });

  return byDomain;
}

// Picks the best fetched page for classification, among pages with
// substantial content — a thin/near-empty page matching a URL pattern must
// never beat a content-rich homepage just because its path looks more
// promising.
//
// TIERED, not one flat regex: a TEAM/leadership page outranks a generic
// About page, because the whole product turns on "two generations named on
// the company's own team page" — that's where a founder and a next-gen
// family member actually appear side by side, while /about is usually
// company history prose. The old flat regex treated /about and
// /about-us/our-team/ as equally good and returned whichever came first in
// fetch order, so a real team page could lose to a generic one.
const MIN_SUBSTANTIAL_LENGTH = 300;
const TEAM_URL_RE = /team|leadership|staff|meet-|our-people|our-family/i;
const ABOUT_URL_RE = /about|who-we-are|our-story|history/i;

export function pickBestPage(pages: FetchedPage[]): FetchedPage | null {
  if (pages.length === 0) return null;
  const substantial = pages.filter((p) => p.text.length >= MIN_SUBSTANTIAL_LENGTH);
  const pool = substantial.length > 0 ? substantial : pages;

  // Within a tier, prefer the longest page — more text, more chance both
  // generations are actually on it.
  const byLength = (a: FetchedPage, b: FetchedPage) => b.text.length - a.text.length;

  const team = pool.filter((p) => TEAM_URL_RE.test(p.url)).sort(byLength);
  if (team.length > 0) return team[0];

  const about = pool.filter((p) => ABOUT_URL_RE.test(p.url)).sort(byLength);
  if (about.length > 0) return about[0];

  return [...pool].sort(byLength)[0];
}
