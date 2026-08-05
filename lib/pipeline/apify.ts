import type { Industry } from "../supabase/types";
import { industryLabel } from "./parse-query";

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_BASE = "https://api.apify.com/v2";

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
  if (!APIFY_TOKEN) throw new Error("APIFY_TOKEN is not set");
  const res = await fetch(
    `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=${timeoutSecs}`,
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

// Step 1 — discovery. One Google-search-scraper run, structured query built
// from the parsed industry/state intent, deduped to unique company domains
// with directory/social sites filtered out.
export async function discoverCandidates(params: {
  industry: Industry | null;
  states: string[];
  limit: number;
}): Promise<Candidate[]> {
  const { industry, states, limit } = params;

  const industryPart = industryLabel(industry);
  const statePart = states.length > 0 ? states.join(" OR ") : "";
  const query = [
    `family owned ${industryPart} company`,
    statePart,
    "about us",
  ]
    .filter(Boolean)
    .join(" ");

  const items = (await runActorSync("apify~google-search-scraper", {
    queries: query,
    resultsPerPage: Math.min(limit * 4, 100),
    maxPagesPerQuery: 1,
    countryCode: "us",
    languageCode: "en",
  })) as Array<{ organicResults?: Array<{ url: string; title: string }> }>;

  const organic = items.flatMap((page) => page.organicResults ?? []);

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const r of organic) {
    const host = hostnameOf(r.url);
    if (!host || isBlocked(host) || seen.has(host)) continue;
    if (isListicleTitle(r.title)) continue;
    seen.add(host);
    candidates.push({ domain: host, url: r.url, title: r.title ?? host });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

// "Best landscaping companies in X," "Top 10 home builders" — directory/
// roundup articles that show up in the same search results as real company
// sites. They're never "the company's own website," so filter on title
// before a single Apify or OpenRouter call is spent on one.
function isListicleTitle(title: string | undefined): boolean {
  if (!title) return false;
  return /\b(best|top\s*\d+|\d+\s*best|reviews?)\b/i.test(title);
}

export interface FetchedPage {
  domain: string;
  url: string;
  text: string;
  siteName: string | null; // og:site_name — the cleanest source for the real company name
}

const ABOUT_SLUGS = [
  "",
  "about",
  "about-us",
  "our-story",
  "our-team",
  "team",
  "leadership",
  "who-we-are",
];

// Step 2 — page fetch. Guesses the common About/Team/Leadership URL slugs per
// domain and fetches them directly (maxCrawlDepth 0 — no link-following, so
// 404s on guessed slugs are cheap and don't blow the run budget). One actor
// run covers every candidate domain at once.
export async function fetchCompanyPages(domains: string[]): Promise<Map<string, FetchedPage[]>> {
  const startUrls = domains.flatMap((domain) =>
    ABOUT_SLUGS.map((slug) => ({ url: `https://${domain}/${slug}` }))
  );

  const items = (await runActorSync(
    "apify~website-content-crawler",
    {
      startUrls,
      crawlerType: "cheerio",
      maxCrawlDepth: 0,
      maxCrawlPages: startUrls.length,
      maxRequestRetries: 1,
      saveMarkdown: false,
    },
    180
  )) as Array<{
    url: string;
    text?: string;
    crawl?: { httpStatusCode?: number };
    metadata?: { openGraph?: Array<{ property: string; content: string }> };
  }>;

  const byDomain = new Map<string, FetchedPage[]>();
  for (const item of items) {
    const host = hostnameOf(item.url);
    // Drop anything that didn't actually load — a 404's boilerplate nav/footer
    // text is often >50 chars and would otherwise sail through to an LLM call
    // that can only ever conclude "no content here."
    if (!host || !item.text || item.text.trim().length < 50) continue;
    if (item.crawl?.httpStatusCode && item.crawl.httpStatusCode !== 200) continue;
    const siteName =
      item.metadata?.openGraph?.find((og) => og.property === "og:site_name")?.content ?? null;
    const list = byDomain.get(host) ?? [];
    list.push({ domain: host, url: item.url, text: item.text, siteName });
    byDomain.set(host, list);
  }
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
