import { resolveSetting } from "../settings";
import { recordCost } from "./cost-tracker";

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
    recordCost("firecrawl_scrape");
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

