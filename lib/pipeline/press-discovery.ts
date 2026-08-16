/**
 * Succession stories as a discovery channel.
 *
 * THE OBSERVATION THIS EXISTS FOR. apify.ts blocks publishers by domain
 * (MEDIA_SUFFIX_RE, MEDIA_HOST_RE) because a succession phrase matches STORIES
 * ABOUT family businesses far more often than the businesses' own sites — 10
 * of 12 sampled results were magazines, newspapers and trade press, each
 * costing a fetch plus a classification call to conclude "this is a magazine".
 * Blocking them was right, and it threw away the best evidence in the pipeline.
 *
 * A local paper writing "after 34 years, Bill Hansen is handing Hansen
 * Landscaping to his daughter Erin" has stated, on the record, exactly what
 * this product spends $0.037 a company trying to infer from About pages that
 * are written to sell mulch. The company's own site frequently never says it:
 * the classifier reads "family owned since 1989" and has to guess.
 *
 * So the article is not a candidate, it is a SOURCE OF candidates. Read the
 * story, take the company it is about, and hand that company's own domain to
 * the pipeline like any other candidate. The site is still fetched and still
 * classified on its own merits; nothing here bypasses the gates. What changes
 * is which doors get knocked on.
 *
 * WHY THIS IS FREE. No new vendor:
 *   - the search is tavily_search, already the web-search channel's unit
 *   - the article is read with a plain fetch (see freeFetchText), no Firecrawl
 *   - one extract_call at $0.002 on the cheap model turns it into companies
 * So an article costs $0.002 plus its share of a search, against $0.037 a
 * company for cold discovery. If one article in three names a real company,
 * this is the cheapest channel in the system.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not infer email addresses. The
 * comparable product that reaches 100% contact coverage does it by guessing
 * three variants per person from a colleague's address; those are constructed,
 * not found. Handing Jonathan three guesses per founder would raise the
 * contact column and lower the quality of what he actually sends.
 */

import { chat, extractJson, getExtractModel } from "./openrouter";
import { tavilySearch } from "./tavily";
import { recordCost } from "./cost-tracker";
import { stateNameFor } from "./us-states";
import type { Industry } from "../supabase/types";
import type { Candidate } from "./apify";

/** Trade words per vertical, kept short: the story's own words do the work. */
const TRADE_WORDS: Record<Industry, string> = {
  landscaping: "landscaping",
  home_builder: "home building",
  construction: "construction",
  trades: "plumbing OR HVAC OR electrical",
  manufacturing: "manufacturing",
  distribution: "distribution OR wholesale",
  property_services: "property services",
  professional_services: "firm",
};

/**
 * Phrasings a REPORTER uses, which are not the phrasings a company uses.
 *
 * "second-generation owner" appears on company About pages; "is handing the
 * business to" essentially only appears when someone is writing about it. That
 * asymmetry is the whole point of the channel, so the queries lean on the
 * reporting voice rather than reusing the site-facing succession phrases.
 */
const STORY_ANGLES = [
  'family business "passing the torch" son OR daughter',
  '"taking over the family business" from his father OR her father',
  '"second generation" takes over family company',
  'founder "hands over" family business to son OR daughter',
];

/**
 * Hosts that are never a press article, measured rather than guessed.
 *
 * The first live run of this channel returned 8 results of which 5 were
 * Facebook, Instagram and YouTube. They are worthless here twice over: a
 * social post is not reporting, and every one of those hosts blocks the
 * plain fetch below, so each cost an attempt to retrieve nothing. Forums and
 * video are the same story from the other direction -- lawnsite.com is
 * landscapers talking shop, not a paper reporting a handover.
 */
/**
 * National business press, blocked for the OPPOSITE reason to the social
 * hosts: these are real reporting, and that is the problem.
 *
 * The first run that worked returned exactly one company, from Fortune:
 * Related Group, a billionaire's real-estate empire, whose founder spent
 * twenty years handing it to his sons. A textbook succession story about a
 * company two orders of magnitude outside the $5-30M band this product
 * exists for. Fortune does not write about a landscaper in Waterbury, and
 * a landscaper in Waterbury is the entire point.
 *
 * The gates downstream would cut it on size, so this is not about
 * correctness -- it is about not paying a fetch and a classification call
 * to be told a billionaire is not a small family business.
 */
const NATIONAL_PRESS_RE =
  /^(www\.)?(fortune|forbes|bloomberg|wsj|cnbc|businessinsider|inc|entrepreneur|axios|reuters|ft|economist|fastcompany|techcrunch|barrons|marketwatch)\./i;

const NOT_PRESS_RE =
  /^(m\.|.*\.)?(facebook|instagram|youtube|linkedin|tiktok|twitter|x|pinterest|reddit|threads|vimeo|yelp|indeed|glassdoor|lawnsite|quora)\./i;

function hostnameOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Read an article without paying for it.
 *
 * Deliberately NOT Firecrawl. A news article is ordinary server-rendered HTML;
 * the rendering budget belongs to company sites, which are the ones built as
 * single-page apps. If the fetch fails, Tavily's own snippet is used instead,
 * which is already bought and often carries the key sentence.
 */
async function freeFetchArticle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const pageHost = hostnameOf(url);
    const text = (await res.text())
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      // Keep outbound hrefs beside their anchor text. A story about a company
      // very often links to it, and that link is the company's real domain
      // rather than one guessed from its name — the same failure that made
      // directory-discovery invent five domains out of eight.
      .replace(
        /<a\b[^>]*?\bhref=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_m, href: string, inner: string) => {
          const host = hostnameOf(href);
          if (!host || host === pageHost) return ` ${inner} `;
          return ` ${inner} (${href}) `;
        }
      )
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length < 400 ? null : text;
  } catch {
    return null;
  }
}

export interface PressFind {
  name: string;
  website: string;
  /** The sentence that says the succession is happening. Evidence, not colour. */
  quote: string;
  sourceUrl: string;
}

/**
 * Turn one article into the companies it is about.
 *
 * The prompt's hard rule is the same one directory-discovery learned the
 * expensive way: never construct a URL. A story that names a company without
 * linking it is a story we skip. Guessing produces domains that do not
 * resolve, and the real business is lost with no trace.
 */
async function extractFromArticle(text: string, url: string): Promise<PressFind[]> {
  const prompt = `This is the text of a news or trade-press article. It may be about a family business changing hands between generations, or it may be about something else entirely.

Find every company the article describes as being handed from one generation of a family to the next: a founder or current owner still leading, and a son, daughter or other family member stepping into it. The transition can be announced, under way, or recently completed.

Return for each one:
- "name": the company's name as the article gives it
- "website": the company's OWN website, copied EXACTLY from a link in the text. Never construct, guess or complete a URL from the company name. If the article does not link the company, skip that company entirely. A guessed domain is worse than nothing: it does not resolve, and the real business is lost.
- "quote": the sentence from the article that states the succession, copied verbatim.

Skip the publisher itself, other companies merely mentioned, advertisers, and any business where the article does not actually describe a generational handover. If the article is not about a family-business succession at all, return an empty list. Returning nothing is the correct and common answer.

Respond with ONLY a JSON object (no markdown fences, no prose): {"companies": [{"name": string, "website": string, "quote": string}]}.

Article text:
"""
${text.slice(0, 7000)}
"""`;

  try {
    recordCost("extract_call");
    const raw = await chat([{ role: "user", content: prompt }], 1200, await getExtractModel());
    const parsed = extractJson<{ companies: { name: string; website: string; quote: string }[] }>(raw);
    if (!Array.isArray(parsed.companies)) return [];
    return parsed.companies
      .filter((c) => c && c.name && c.website && hostnameOf(c.website))
      .map((c) => ({
        name: String(c.name).trim(),
        website: String(c.website).trim(),
        quote: String(c.quote ?? "").trim(),
        sourceUrl: url,
      }));
  } catch {
    return [];
  }
}

/**
 * Per-process memo, matching directory-discovery's.
 *
 * A single search re-runs discovery every time its candidate buffer drains,
 * and an article cannot change over the minutes one search lasts. Without
 * this, each re-run re-fetched and re-extracted the same stories.
 */
const articleMemo = new Map<string, { at: number; finds: PressFind[] }>();
const MEMO_TTL_MS = 10 * 60_000;

async function readArticle(url: string, snippet?: string): Promise<PressFind[]> {
  const hit = articleMemo.get(url);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.finds;

  const body = await freeFetchArticle(url);
  // Tavily's snippet is already paid for and often carries the key sentence,
  // so a paywall or a 403 does not have to end the attempt.
  // 300, not 400. A news snippet routinely arrives at ~1150 characters and
  // carries the whole lede, which is where the succession sentence lives; the
  // threshold only exists to avoid spending an extract on a stub.
  const text = body ?? (snippet && snippet.length > 300 ? snippet : null);
  if (!text) {
    articleMemo.set(url, { at: Date.now(), finds: [] });
    return [];
  }
  const finds = await extractFromArticle(text, url);
  articleMemo.set(url, { at: Date.now(), finds });
  return finds;
}

/**
 * The channel.
 *
 * Returns ordinary Candidates pointing at the COMPANIES' own domains, so
 * everything downstream — the fetch, the classifier, the disprove pass, every
 * gate — runs exactly as it does for any other channel. The article's sentence
 * rides along in `pressQuote` as a hint, not as a verdict: the company's own
 * page still has to earn the signal, because a 2019 story about a handover
 * that never completed should not qualify anyone in 2026.
 */
export async function discoverViaPress(
  industries: Industry[],
  states: string[],
  limit: number,
  excludeDomains: Set<string>
): Promise<Candidate[]> {
  const stateNames = states.map(stateNameFor);
  if (limit <= 0) return [];

  // One angle per call, widened by trade and state. Two states at a time keeps
  // the query specific enough to return local press rather than national
  // features, which are about companies far larger than the $5-30M band.
  const trade = TRADE_WORDS[industries[0] ?? "landscaping"] ?? "";
  const where = stateNames.slice(0, 2).join(" OR ");
  const angle = STORY_ANGLES[Math.floor(Math.random() * STORY_ANGLES.length)];
  const query = `${angle} ${trade} ${where}`.replace(/\s+/g, " ").trim();

  let results: Awaited<ReturnType<typeof tavilySearch>>;
  try {
    // topic "news" rather than the default "general", and the difference is
    // not marginal. Measured on the same query: "general" returned 8 results
    // of which 5 were social, with 100-140 character snippets; "news"
    // returned 3, none social, and the one real article's snippet went from
    // 108 characters to 1154 -- enough to extract from WITHOUT fetching the
    // page at all, which is what makes a paywall survivable.
    //
    // The cost is tavily.ts's `country` nudge, which Tavily only honours
    // under "general". Worth it here and nowhere else: this channel wants
    // reporting, and the state name is already in the query.
    results = await tavilySearch(query, { maxResults: 8, topic: "news" });
  } catch {
    // A dark channel is not a failed run. The caller reports it and carries on
    // with the channels that did answer.
    return [];
  }

  const finds: PressFind[] = [];
  for (const r of results) {
    if (finds.length >= limit * 3) break;
    // Skip before spending an extract. A social post is not reporting, and
    // these hosts block the fetch anyway.
    const h = hostnameOf(r.url);
    if (NOT_PRESS_RE.test(h) || NATIONAL_PRESS_RE.test(h)) continue;
    finds.push(...(await readArticle(r.url, r.content)));
  }
  return toCandidates(finds, industries, states, excludeDomains, limit);
}

/**
 * Article findings to candidates.
 *
 * Split out from the network path so the rules that decide what reaches the
 * pipeline can be tested without buying a search or a model call. Every one of
 * them is a rule this channel would otherwise get wrong in the expensive
 * direction: returning the newspaper as a lead, re-reading a company the run
 * has already settled, or letting one article's three mentions of the same
 * business fill the whole round's budget.
 */
/** Exported so the filters can be tested against real measured hosts. */
export function isPressWorthy(host: string): boolean {
  if (!host) return false;
  return !NOT_PRESS_RE.test(host) && !NATIONAL_PRESS_RE.test(host);
}

export function toCandidates(
  finds: PressFind[],
  industries: Industry[],
  states: string[],
  excludeDomains: Set<string>,
  limit: number
): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const f of finds) {
    if (out.length >= limit) break;
    const domain = hostnameOf(f.website);
    if (!domain) continue;
    // NEVER RETURN THE PUBLISHER. Converting press into companies is the whole
    // point; handing back the newspaper is the mistake the channel exists to
    // undo, and it would cost a fetch and a classification call to rediscover
    // that a newspaper is a newspaper.
    if (domain === hostnameOf(f.sourceUrl)) continue;
    // Already settled by an earlier round or an earlier search. The cross-
    // search memory is the reason a re-run is cheap; ignoring it here would
    // quietly re-buy pages the pipeline has already judged.
    if (excludeDomains.has(domain)) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push({
      name: f.name,
      domain,
      url: f.website,
      channel: "press",
      state: states.length === 1 ? states[0] : null,
      industry: industries[0] ?? null,
      pressQuote: f.quote || null,
      pressSourceUrl: f.sourceUrl,
      // The article's headline is not this company's page title, and
      // pretending otherwise would put a newspaper's words in the row.
      title: f.name,
    } as Candidate);
  }

  return out;
}
