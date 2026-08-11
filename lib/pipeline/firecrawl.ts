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

async function getFirecrawlKey(): Promise<string | null> {
  return resolveSetting("FIRECRAWL_API_KEY", process.env.FIRECRAWL_API_KEY);
}

/**
 * Scrape one URL to plain text. Returns null when unconfigured or on any
 * failure, so callers fall through to the next layer instead of breaking.
 */
export async function firecrawlScrape(url: string, attempt = 0): Promise<string | null> {
  const key = await getFirecrawlKey();
  if (!key) return null;

  try {
    if (attempt === 0) recordCost("firecrawl_scrape");
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        // FOOTERS ARE KEPT, and that is a deliberate reversal.
        //
        // This was `true`, to strip the nav/footer chrome that made a free
        // fetch look "successful" on a JS-gated page while returning nothing
        // of substance. The thinness check below (< 200 chars) is what
        // actually catches that case, and stripping the footer was throwing
        // away the single most useful part of a small business's website.
        //
        // Measured on six real leads, main-content-only versus full page:
        //   phone number found   3/6  ->  5/6   (the miss returns 0 chars)
        //   personal email seen  n/a  ->  3/6   roger@, craig@, atollman@
        //
        // A landscaping company puts its phone number in the footer of every
        // page. It costs ~2,300 extra characters (~590 tokens, about $0.002)
        // per company to keep it, and it buys the contact details this product
        // otherwise pays AnymailFinder $0.05 a time to discover.
        onlyMainContent: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    // 429 IS NOT A DEAD PAGE. The plan allows ~45 requests a minute and this
    // is called concurrently, so a burst hits the ceiling routinely. Returning
    // null there made a throttled page indistinguishable from a site that no
    // longer exists — the company was written off, and the discovery and SERP
    // spend that found it went with it. A backfill of 43 pages recorded 33
    // "unreachable" this way; every one of them was a 429, and none had cost a
    // credit. Firecrawl states how long to wait, so wait exactly that long.
    if (res.status === 429 && attempt < 2) {
      const body = await res.text().catch(() => "");
      const secs = Number(body.match(/retry after (\d+)s/i)?.[1] ?? 0);
      const waitMs = Math.min(Math.max(secs * 1000, 2_000), 30_000);
      await new Promise((r) => setTimeout(r, waitMs));
      return firecrawlScrape(url, attempt + 1);
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    const md: string = data?.data?.markdown ?? "";
    return md.trim().length < 200 ? null : md;
  } catch {
    return null;
  }
}

