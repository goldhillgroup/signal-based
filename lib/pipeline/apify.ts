import type { Industry } from "../supabase/types";
import { stateNameFor } from "./us-states";
import { resolveSetting } from "../settings";

// Prefers APIFY_TOKEN_3, then _2, then the primary APIFY_TOKEN — keeps
// test-run cost off Jonathan's account during development. _2 ran dry
// testing actor schemas (see .env.local); _3 is the current one with real
// balance. Editable from /dashboard/settings (DB value wins); each falls
// through to its own env var when unset in Settings — see lib/settings.ts.
async function getApifyToken(): Promise<string> {
  const [t3, t2, t1] = await Promise.all([
    resolveSetting("APIFY_TOKEN_3", process.env.APIFY_TOKEN_3),
    resolveSetting("APIFY_TOKEN_2", process.env.APIFY_TOKEN_2),
    resolveSetting("APIFY_TOKEN", process.env.APIFY_TOKEN),
  ]);
  const token = t3 || t2 || t1;
  if (!token) throw new Error("APIFY_TOKEN is not set");
  return token;
}
const APIFY_BASE = "https://api.apify.com/v2";

// Vertical-specific Google Maps category searches — matches the two
// verticals in the signed scope (family-owned landscaping + home builders).
// Real-world terms a business would actually list itself under on its
// Google Business Profile, not generic marketing phrasing.
const VERTICAL_SEARCH_TERMS: Record<Industry, string[]> = {
  landscaping: ["landscaping company", "lawn care company", "landscape design company"],
  home_builder: ["custom home builder", "general contractor", "home construction company"],
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

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isBlocked(host: string): boolean {
  return BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));
}

async function runActorSync(actorId: string, input: Record<string, unknown>, timeoutSecs = 120) {
  const token = await getApifyToken();
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
  const perTerm = Math.min(20 * round, 120);
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
const SUCCESSION_QUERY_TERMS: Record<Industry, string[]> = {
  landscaping: [
    '"second generation" family owned landscaping company',
    '"family owned" landscaping company "joined the business"',
    'father son landscaping company "family business"',
  ],
  home_builder: [
    '"second generation" family owned home builder',
    '"family owned" custom home builder "joined the business"',
    'father son home builder "family business"',
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

// Step 1 — discovery. Two channels run in parallel and get merged: Maps for
// broad, low-noise category coverage, targeted web search for succession-
// specific precision. Promise.allSettled — one channel timing out or erroring
// must not take the other's real results down with it (a real Maps timeout
// happened live during testing; a round should degrade to "web search results
// only" rather than fail outright over an unrelated channel's hiccup).
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

  const [mapsResult, webResult] = await Promise.allSettled([
    discoverViaMaps(industry, states, limit, round),
    discoverViaWebSearch(industry, states, limit),
  ]);

  const channelErrors: string[] = [];
  const raw: Candidate[] = [];
  if (mapsResult.status === "fulfilled") raw.push(...mapsResult.value);
  else channelErrors.push(`Maps channel failed: ${mapsResult.reason?.message?.slice(0, 150) ?? mapsResult.reason}`);
  if (webResult.status === "fulfilled") raw.push(...webResult.value);
  else channelErrors.push(`Web search channel failed: ${webResult.reason?.message?.slice(0, 150) ?? webResult.reason}`);

  if (mapsResult.status === "rejected" && webResult.status === "rejected") {
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
  // meaning both channels combined have nothing left to give for this
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

// One domain's 5 URL guesses, in a single small actor call with a fixed,
// predictable timeout. Failure here (that domain's site hangs/times out)
// only costs that one domain — never the batch.
async function fetchOneDomain(domain: string): Promise<RawFetchedItem[]> {
  const startUrls = ABOUT_SLUGS.map((slug) => ({ url: `https://${domain}/${slug}` }));
  return (await runActorSync(
    "apify~website-content-crawler",
    {
      startUrls,
      crawlerType: "cheerio",
      maxCrawlDepth: 0,
      maxCrawlPages: startUrls.length,
      maxRequestRetries: 1,
      saveMarkdown: false,
    },
    60 // 5 URLs, cheerio (no JS rendering) — this is generous on its own; the
    // old design's problem was never "5 URLs need >60s," it was bundling 15
    // domains' worth of URLs behind ONE shared timeout.
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

export async function fetchCompanyPages(domains: string[]): Promise<Map<string, FetchedPage[]>> {
  // Fail loud on real misconfiguration (e.g. missing token) before the
  // per-domain try/catch below has a chance to swallow it as "this domain's
  // site didn't load" — that per-domain tolerance is for individual site
  // failures, not for "nothing can fetch anything."
  await getApifyToken();

  const byDomain = new Map<string, FetchedPage[]>();

  await withConcurrency(domains, FETCH_CONCURRENCY, async (domain) => {
    let items: RawFetchedItem[];
    try {
      items = await fetchOneDomain(domain);
    } catch {
      // This domain's site is slow/down/blocking — it just yields no pages
      // (classify step will insert it as "no page fetched"), everyone else
      // in the round is unaffected.
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

// Picks the best fetched page for classification: prefer an about/team/
// leadership-flavored URL, but only among pages with substantial content —
// a thin/near-empty page matching the URL pattern must never beat a
// content-rich homepage just because its path looks more promising.
const MIN_SUBSTANTIAL_LENGTH = 300;

export function pickBestPage(pages: FetchedPage[]): FetchedPage | null {
  if (pages.length === 0) return null;
  const substantial = pages.filter((p) => p.text.length >= MIN_SUBSTANTIAL_LENGTH);
  const pool = substantial.length > 0 ? substantial : pages;

  const keyworded = pool.find((p) => /about|team|leadership|who-we-are|our-story/i.test(p.url));
  if (keyworded) return keyworded;

  return [...pool].sort((a, b) => b.text.length - a.text.length)[0];
}
