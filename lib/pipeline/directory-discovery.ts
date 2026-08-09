import type { Industry } from "../supabase/types";
import { stateNameFor } from "./us-states";
import { chat, extractJson, getExtractModel } from "./openrouter";
import { tavilySearch, takeTavilyFailure } from "./tavily";
import { firecrawlScrape } from "./firecrawl";
import { hostnameOf, isBlocked, fetchSingleUrl, decodeEntities, type Candidate } from "./apify";
import { createServiceRoleClient } from "../supabase/server";
import { recordCost } from "./cost-tracker";

// Directory-based discovery — the lesson from a real, separate project
// (Ofer Lieberson, German real-estate deal-sourcing): structured directory
// pages (industry association member lists, licensing boards, buying-
// cooperative shareholder pages) were BY FAR the highest-yield discovery
// source there — near-100% real candidates, vs ~6% from raw search-scraping.
// This is the US-vertical equivalent, as a THIRD discovery channel alongside
// apify.ts's Maps + succession-phrase-search channels.
//
// Uses Claude (via OpenRouter's :online web-search plugin), not Apify — per
// instruction, shift discovery weight off Apify (two accounts ran dry this
// session) and onto OpenRouter.
//
// "Smarter over time" — the actual cost mechanism: finding WHICH directory
// covers a given vertical+state is an expensive web-search call, but the URL
// almost never changes once found. directory_sources caches it (Supabase),
// so the SECOND and every later search for the same vertical+state skips
// straight to "fetch this known page" (cheap: fetchSingleUrl) + "extract
// from this given text" (cheap: a plain, non-search Claude call) instead of
// paying the expensive web-search call again. A cache hit that turns up
// nothing (dead link, page restructured) self-heals: the stale row gets
// deleted and that angle falls back to a fresh expensive search.
// Plain fetch for a known directory URL — costs nothing. Mirrors the free
// path in apify.ts's fetchCompanyPages; kept local to avoid widening that
// module's exported surface for one caller.
//
// `gone` separates "this page is definitively not there" (404/410) from "we
// could not check it right now" (timeout, 5xx, network). The cache-eviction
// rule in resolveAngle depends on that distinction and had no way to make it,
// so a permanently-dead source looked transient forever — malibu.org's cached
// member list has 404'd since the day it was stored, and every California run
// since has paid an Apify crawl to re-confirm it and then kept the dead row.
async function freeFetchText(url: string): Promise<{ text: string | null; gone: boolean }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { text: null, gone: res.status === 404 || res.status === 410 };
    const pageHost = hostnameOf(url);
    const text = (await res.text())
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      // Keep each OUTBOUND link's address beside its anchor text before the
      // tags go. Stripping first threw every href away, and on a real member
      // list that is catastrophic rather than merely lossy: NARI Charlotte's
      // directory renders each member's site as the word "Website" wrapping
      // the link, so the extractor was handed eight company names, the literal
      // word "Website" eight times, and no URLs at all — and duly invented
      // them from the names. Five of eight came out wrong; difabion.com and
      // paulkowalskibuilders.com don't even resolve, while the real
      // difabionremodeling.com, pkbuilders.com, detailedinteriors.com and
      // revisioncharlotte.com were all sitting in the markup, live and
      // fetchable. Those are real leads this pipeline paid Tavily and Haiku to
      // find and then threw away.
      // Same-host and aggregator links are dropped, so this adds the member
      // URLs without spending the extraction budget on the directory's own nav.
      // Plain parentheses, NOT angle brackets — the generic tag strip below
      // would eat a <url> marker right back off again.
      .replace(
        /<a\b[^>]*?\bhref=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_m, href: string, inner: string) => {
          const host = hostnameOf(href);
          if (!host || host === pageHost || isBlocked(host)) return ` ${inner} `;
          return ` ${inner} (${href}) `;
        }
      )
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { text: text.length < 300 ? null : text, gone: false };
  } catch {
    return { text: null, gone: false };
  }
}

// NOTE: the ":online" variant is deliberately gone — see searchOneAngle for
// why (it billed search as LLM tokens and dominated a whole day's spend).

// Angles cover each vertical's whole trade family — the green trades include
// tree care and irrigation, which have their own trade associations (TCIA,
// Irrigation Association) that NALP's directory won't list. See
// openrouter.ts's CLASSIFY_SYSTEM for why the umbrella is this wide.
const DIRECTORY_ANGLES: Record<Industry, string[]> = {
  landscaping: [
    "the official state contractor/landscaper licensing board's public license-holder lookup",
    "NALP (National Association of Landscape Professionals) local chapter or member directory",
    "TCIA (Tree Care Industry Association) or Irrigation Association member directory, or a state arborist/irrigation association member list",
    "a local Chamber of Commerce or BBB-accredited-business directory listing for landscaping, tree service, or irrigation companies",
  ],
  home_builder: [
    "the official state contractor licensing board's public license-holder lookup for home builders/general contractors",
    "NAHB (National Association of Home Builders) local Home Builders Association member directory",
    "NARI (National Association of the Remodeling Industry) local chapter member directory",
    "a local Chamber of Commerce or BBB-accredited-business directory listing for custom home builders or design-build remodelers",
  ],
};

function anglesFor(industry: Industry | null): string[] {
  if (industry) return DIRECTORY_ANGLES[industry];
  return [...DIRECTORY_ANGLES.landscaping, ...DIRECTORY_ANGLES.home_builder];
}

interface DirectoryResult {
  sourceUrl: string | null;
  companies: { name: string; website: string }[];
}

// Discovery path — find WHICH page lists these companies, then read it.
//
// Rewritten off OpenRouter's ":online" (2026-08-07). That version bundled
// search into the model call, so every fetched result landed in the prompt at
// full size; reconstructed from one day's spend it ran ~$0.50/call and
// accounted for roughly $26 of a $30 OpenRouter balance, versus ~$2 for all
// the real classification work. Now: Tavily finds the page (~$0.008, priced as
// search), a layered fetch reads it for free where possible, and a plain
// non-search model call does the extraction. Search and reasoning are billed
// separately again.
async function searchOneAngle(angle: string, stateName: string): Promise<DirectoryResult> {
  const results = await tavilySearch(`${angle} in ${stateName}, USA`, { maxResults: 6 });
  if (results.length === 0) {
    // Distinguish "searched, found nothing" from "could not search". The second
    // means this channel is dark and the run must say so — reported by throwing,
    // which discoverCandidates turns into a channel error on the search row
    // rather than a quietly smaller result set.
    const why = takeTavilyFailure();
    if (why) {
      throw new Error(
        why === "no_key"
          ? "Directory search is unavailable: no Tavily key is configured."
          : why === "rate_limited"
            ? "Directory search is unavailable: Tavily is rate-limited or out of credit."
            : "Directory search is unavailable: Tavily could not be reached."
      );
    }
    return { sourceUrl: null, companies: [] };
  }

  // Drop the aggregators BEFORE taking the top 4, not inside the loop. Blocked
  // hosts used to burn a read attempt each, and they cluster: on the real NC
  // home-builder chamber angle, ranks 1-3 were all bbb.org, so the single page
  // this angle ever read was rank 4 — one builder's own marketing site, which
  // then got cached as that state's "directory" — while the actual Winston-
  // Salem HBA member list at rank 5 was never reached.
  const readable = results.filter((r) => !isBlockedDirectoryHost(r.url));

  // Try candidates in rank order and keep the first that actually yields
  // companies — the top hit is often an association's marketing page rather
  // than its member list.
  for (const r of readable.slice(0, 4)) {
    const pageText = await readDirectoryPage(r.url, r.content);
    if (!pageText) continue;

    const companies = dropSelfListing(await extractFromKnownPage(pageText, angle, stateName), r.url);
    if (companies.length > 0) {
      return { sourceUrl: r.url, companies };
    }
  }
  return { sourceUrl: null, companies: [] };
}

// A directory is never its own lead. When an angle lands on a vendor's
// marketing page the extractor dutifully returns exactly one "company" — the
// vendor — which was enough to look like a successful lookup: the URL got
// cached as that state's directory, the vendor got classified at full Sonnet
// price, and every later search for that vertical+state re-read the same page
// forever. Four of the nine sources cached on 2026-08-07 are exactly this
// (trackmyvendor.com twice, harborcompliance.com, tcia.org), and two of them
// reached the classifier, which duly reported "SaaS compliance-tracking
// platform". Dropping the self-listing leaves zero companies, which is the
// truth — and lets the existing eviction rule finally throw the row away.
function dropSelfListing(
  companies: { name: string; website: string }[],
  sourceUrl: string
): { name: string; website: string }[] {
  const pageHost = hostnameOf(sourceUrl);
  if (!pageHost) return companies;
  return companies.filter((c) => c.website && hostnameOf(c.website) !== pageHost);
}

// Reads a directory page through the cheapest layer that works:
//   1. free plain fetch          — costs nothing, handles server-rendered pages
//   2. Tavily's own extracted content — already paid for by the search
//   3. Firecrawl                 — renders JS-gated / bot-blocked pages
// This ordering is the "freedom" property: no single vendor can block a
// lookup, and the expensive layer only runs when the free ones genuinely
// cannot see the content.
async function readDirectoryPage(url: string, tavilyContent?: string): Promise<string | null> {
  const { text: free } = await freeFetchText(url);
  if (free && free.length > 1500) return free;

  // Tavily returns a content snippet with every result — small, but free at
  // this point since the search is already paid for.
  if (tavilyContent && tavilyContent.length > 800) return tavilyContent;

  // Last resort: the only layer that renders JS. Measured on
  // members.georgiaarborist.org — free fetch 2,273 chars of nav chrome,
  // Firecrawl 34,844 chars including the actual member list.
  const rendered = await firecrawlScrape(url);
  if (rendered) return rendered;

  return free ?? tavilyContent ?? null;
}

// Aggregators and review sites that turn up in directory searches but never
// list a company's own site usefully.
function isBlockedDirectoryHost(url: string): boolean {
  return /yelp\.|angi\.|thumbtack\.|houzz\.|facebook\.|linkedin\.|bbb\.org|yellowpages\./i.test(url);
}

// Cheap path — the directory URL is already known; just read it and extract,
// no search fee, no web-search token overhead.
async function extractFromKnownPage(
  pageText: string,
  angle: string,
  stateName: string
): Promise<{ name: string; website: string }[]> {
  const prompt = `This is the text of a business directory/listing page — ${angle} in ${stateName}, USA.

Extract every real company name with its own website URL that's listed on this page. Skip the directory's own links, social media profiles, and anything without a clear company website.

Copy each website EXACTLY as it appears in the text — never guess, construct, or complete one from the company's name. A listing with no URL next to it is a listing you must skip, even if the company name makes an address obvious. This is not a formality: asked to read a member list that showed names but no addresses, an earlier run returned invented domains for 5 of 8 companies (two of which do not resolve at all) and the real businesses were lost. Returning fewer companies is always correct; returning a plausible-looking URL that nobody published is not.

ONLY return companies that plausibly belong to the trade described above. Many directory pages — chamber of commerce and BBB member lists especially — are GENERAL business listings sorted alphabetically, so page one is whatever starts with "A" regardless of industry. A real run against one of those returned Accenture, ADP, a bank, a community college and a pest-control firm, and every one cost a full classification call to reject. If a listing is obviously a different industry (national consultancy, bank, insurer, school, hospital, staffing firm, restaurant, retailer, trade association, government body), skip it. Judge by the company name and any category text beside it; when a listing is genuinely ambiguous, keep it — the classifier downstream is the careful check, this is just the cheap filter that stops the page's alphabet from setting the agenda.

Respond with ONLY a JSON object (no markdown fences, no prose): {"companies": [{"name": string, "website": string}]}.

Page text:
"""
${pageText.slice(0, 6000)}
"""`;

  try {
    recordCost("extract_call");
    const raw = await chat([{ role: "user", content: prompt }], 1000, await getExtractModel());
    const parsed = extractJson<{ companies: { name: string; website: string }[] }>(raw);
    return Array.isArray(parsed.companies) ? parsed.companies : [];
  } catch {
    return [];
  }
}

// Per-process memo over resolveAngle. A single search re-runs discovery
// every time its candidate buffer drains, and before this, each re-run
// re-fetched and re-extracted (4 Haiku calls) the exact same directory
// pages — content that cannot change over the minutes one search lasts.
// 10-minute TTL: long enough to cover any one search, short enough that
// tomorrow's search re-reads the live page.
const angleMemo = new Map<string, { at: number; companies: { name: string; website: string }[] }>();
const ANGLE_MEMO_TTL_MS = 10 * 60_000;

async function resolveAngle(
  industry: Industry | null,
  state: string,
  stateName: string,
  angle: string
): Promise<{ name: string; website: string }[]> {
  const supabase = createServiceRoleClient();
  const industryKey = industry ?? "both";

  const memoKey = `${industryKey}|${state}|${angle}`;
  const memod = angleMemo.get(memoKey);
  if (memod && Date.now() - memod.at < ANGLE_MEMO_TTL_MS) return memod.companies;

  const { data: cached } = await supabase
    .from("directory_sources")
    .select("*")
    .eq("industry", industryKey)
    .eq("state", state)
    .eq("angle", angle)
    .maybeSingle();

  if (cached) {
    // FREE fetch first, Apify only as fallback. This used to go straight to
    // Apify, which turned a capped/failing Apify account into a compounding
    // OpenRouter bill: fetch fails -> row deleted -> expensive :online search
    // re-runs -> every single round, forever.
    const free = await freeFetchText(cached.source_url);
    let pageText = free.text;
    let fetchFailed = false;
    if (!pageText && !free.gone) {
      // Only escalate to the paid crawler when the page MIGHT still be there.
      // A 404/410 is the site answering the question, so paying Apify to hear
      // the same answer — and then treating it as an unverifiable failure that
      // protects the row from eviction — kept dead sources alive indefinitely.
      pageText = await fetchSingleUrl(cached.source_url);
      if (!pageText) fetchFailed = true;
    }

    if (pageText) {
      const companies = dropSelfListing(
        await extractFromKnownPage(pageText, angle, stateName),
        cached.source_url
      );
      if (companies.length > 0) {
        await supabase
          .from("directory_sources")
          .update({ hit_count: cached.hit_count + companies.length, last_used_at: new Date().toISOString() })
          .eq("id", cached.id);
        angleMemo.set(memoKey, { at: Date.now(), companies });
        return companies;
      }
    }

    // Evict when the page gave us a real answer and that answer was "nothing
    // here" — it loaded and yielded no companies, or it 404'd. Either way the
    // source is genuinely dead or restructured. A fetch FAILURE is transient
    // (budget cap, timeout, network, bot-block) and must NOT throw away a
    // known-good source; conflating the two is what made this expensive.
    if (!fetchFailed) {
      await supabase.from("directory_sources").delete().eq("id", cached.id);
    } else {
      // Couldn't check it this round — leave the row alone and skip the
      // expensive re-search, rather than paying to rediscover what we already
      // have on file.
      return [];
    }
  }

  const { sourceUrl, companies } = await searchOneAngle(angle, stateName);
  if (companies.length > 0) angleMemo.set(memoKey, { at: Date.now(), companies });
  if (sourceUrl && companies.length > 0) {
    await supabase
      .from("directory_sources")
      .upsert(
        {
          industry: industryKey,
          state,
          angle,
          source_url: sourceUrl,
          hit_count: companies.length,
          discovered_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "industry,state,angle" }
      );
  }
  return companies;
}

export async function discoverViaDirectories(
  industry: Industry | null,
  states: string[],
  limit: number,
  round = 1
): Promise<Candidate[]> {
  // Rotate which state this call covers — states[0] alone meant a
  // multi-state search never looked at state 2's directories at all.
  const state = states.length > 0 ? states[(round - 1) % states.length] : "US";
  const stateName = states.length > 0 ? stateNameFor(state) : "the United States";
  const angles = anglesFor(industry);

  // "Several subagents" — each directory angle runs as its own concurrent
  // call (cache-check + either the cheap or expensive path), same
  // parallelization idea as the Ofer project's parallel Claude Code research
  // agents, translated to what a deployed server-side pipeline can do:
  // concurrent API calls instead of interactive subagents.
  const results = await Promise.all(angles.map((angle) => resolveAngle(industry, state, stateName, angle)));

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const company of results.flat()) {
    if (!company?.website) continue;
    const host = hostnameOf(company.website);
    if (!host || isBlocked(host) || seen.has(host)) continue;
    seen.add(host);
    candidates.push({
      domain: host,
      url: company.website,
      title: decodeEntities(company.name || host),
      channel: "directory",
    });
    // No break at `limit` — every extracted name is already paid for, and
    // the orchestrator's buffer consumes the surplus in later rounds
    // instead of re-billing discovery to find the same names again.
  }
  return candidates;
}
