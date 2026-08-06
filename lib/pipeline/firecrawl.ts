import { resolveSetting } from "../settings";

// Firecrawl — renders JS-gated and bot-blocked pages a plain fetch can't read.
//
// Strictly a FALLBACK. Plain fetch handles the clear majority of small-trade
// company sites (two consecutive live runs fetched 15/15 and 24/24 for free),
// so paying per page for all of them would be waste. Firecrawl earns its place
// on the minority that free fetch genuinely cannot see — measured on
// members.georgiaarborist.org (a Wild Apricot member directory): free fetch
// returned 2,273 chars of nav chrome, Firecrawl returned 34,844 chars
// containing the actual member list.
//
// Free tier is 1,000 pages/month, and as a fallback-only layer that covers the
// hard minority comfortably.
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

export async function getFirecrawlKey(): Promise<string | null> {
  return resolveSetting("FIRECRAWL_API_KEY", process.env.FIRECRAWL_API_KEY);
}

/**
 * Scrape one URL to plain text. Returns null when unconfigured or on any
 * failure, so callers fall through to the next layer instead of breaking.
 */
export async function firecrawlScrape(url: string): Promise<string | null> {
  const key = await getFirecrawlKey();
  if (!key) return null;

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        // Strips nav/footer/boilerplate — the same chrome that made free
        // fetch look "successful" on JS-gated pages while returning nothing
        // of substance.
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    const md: string = data?.data?.markdown ?? "";
    return md.trim().length < 200 ? null : md;
  } catch {
    return null;
  }
}

/**
 * List a site's URLs. A cleaner answer to "where is this company's team page?"
 * than guessing slugs and following link globs: map the site, then scrape only
 * the page that actually matters.
 *
 * Kept available but not yet wired into the main fetch path — the free
 * slug-guess + one-hop crawl already reaches nested team pages (verified on
 * russelllandscape.com's /about-us/our-team/), and this costs credits where
 * that costs nothing. Worth switching to if free-path team-page recall ever
 * measures poorly.
 */
export async function firecrawlMap(url: string, search?: string): Promise<string[]> {
  const key = await getFirecrawlKey();
  if (!key) return [];

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/map`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ url, ...(search ? { search } : {}) }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.links) ? (data.links as string[]) : [];
  } catch {
    return [];
  }
}
