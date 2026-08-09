import type { Industry } from "../supabase/types";
import { stateNameFor } from "./us-states";
import { resolveSetting } from "../settings";
// Circular by module graph (directory-discovery imports hostnameOf/isBlocked/
// fetchSingleUrl from here), but safe: every binding on both sides is used
// only inside function bodies at call time, never at module-evaluation time,
// so neither module needs the other to be fully initialized when it loads.
import { discoverViaDirectories } from "./directory-discovery";
import { discoverViaLicensing } from "./licensing-discovery";
import { firecrawlScrape } from "./firecrawl";
import { recordCost } from "./cost-tracker";

// Two accounts, down from four (2026-08-07). Tokens 2 and 3 were $5/mo
// free-tier accounts and both ran dry within a day; they are gone rather than
// dormant, because a chain that quietly rotates onto an exhausted account
// converts a billing problem into a 402 mid-search with no explanation.
//
// THE CAP IS PER ACCOUNT, because the two accounts mean different things:
//   - the active token is a developer account. Nothing about this project
//     should ever spend much of it, so it stays on the low self-imposed cap.
//   - APIFY_TOKEN is the CLIENT'S OWN $29/mo plan, and $29/mo of Apify is a
//     line item in the signed scope — it is exactly what he agreed to pay for.
//     Capping it at $10 does not protect him, it throws away $19/month of
//     capacity he is already buying. (It briefly was capped at $10 earlier
//     today; measured against Apify's own cycle data that would have blocked
//     his account on Aug 8 with no refill until Sep 2 — 25 days dark, on a
//     plan with $20 still on it.)
async function getApifyToken(): Promise<{ token: string; capUsd: number }> {
  const [active, clientOwn] = await Promise.all([
    resolveSetting("APIFY_TOKEN_4", process.env.APIFY_TOKEN_4),
    resolveSetting("APIFY_TOKEN", process.env.APIFY_TOKEN),
  ]);
  if (active) return { token: active, capUsd: DEV_CAP_USD };
  if (clientOwn) return { token: clientOwn, capUsd: CLIENT_PLAN_USD };
  throw new Error("No Apify token is set (APIFY_TOKEN_4 or APIFY_TOKEN)");
}
const APIFY_BASE = "https://api.apify.com/v2";

// Developer account: a low self-imposed ceiling. Apify's API refuses to set a
// plan limit below $29 ("cannot be less than 29"), so this is enforced here.
export const DEV_CAP_USD = 10;

// The client's own plan. $29/mo of Apify is a line item in the signed scope,
// so the ceiling is the plan, not an arbitrary fraction of it.
export const CLIENT_PLAN_USD = 29;

// Kept as the name lib/vendor-usage.ts imports for its Apify card denominator.
export const BUDGET_CAP_USD = DEV_CAP_USD;

const BUDGET_CHECK_TTL_MS = 15_000; // avoid hammering /limits on a burst of concurrent fetch calls

// Keyed BY TOKEN. This was a single global, which was harmless while one
// account could ever be active and is a real bug now that two can: a fall
// through to the second token would have read the first account's usage from
// the cache and either blocked a token with room or waved through one without.
// The key is the token string, which never leaves this module.
const budgetCache = new Map<string, { usedUsd: number; checkedAt: number }>();

async function assertUnderBudget(token: string, capUsd: number) {
  const now = Date.now();
  const cached = budgetCache.get(token);
  if (!cached || now - cached.checkedAt > BUDGET_CHECK_TTL_MS) {
    const res = await fetch(`${APIFY_BASE}/users/me/limits?token=${token}`);
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const usedUsd = body?.data?.current?.monthlyUsageUsd;
      if (typeof usedUsd === "number") budgetCache.set(token, { usedUsd, checkedAt: now });
    }
    // A failed limits check doesn't block the run — this is a spending
    // guard, not the primary error path; an outage here shouldn't be why a
    // search fails.
  }
  const entry = budgetCache.get(token);
  if (entry && entry.usedUsd >= capUsd) {
    throw new Error(
      `Apify budget cap hit: this account has used $${entry.usedUsd.toFixed(2)} this cycle (cap: $${capUsd}). Raise the cap in lib/pipeline/apify.ts or switch tokens to continue.`
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
  // Structurally never a family-owned trade business, and all three turned up
  // in one real run off an alphabetical chamber-of-commerce member list
  // (abac.edu, accenture.com, adp.com). Each cost a full Sonnet call to be
  // told it isn't a landscaper. Free to exclude here, before the fetch.
  "accenture.com",
  "adp.com",
  "aarons.com",
  "acuitybrands.com",
  "google.com",
  "maps.google.com",
];

export interface Candidate {
  domain: string;
  url: string;
  title: string;
  // "recheck" is not a discovery channel — it is a company already in the
  // database whose recheck_after came due. Tracked as a channel anyway so the
  // per-channel yield table can measure it against the paid ones; it is the
  // only source whose discovery cost is zero.
  channel: "maps" | "web_search" | "directory" | "licensing" | "recheck";
  /**
   * Which requested state's search surfaced this candidate.
   *
   * The company row used to record `states[0]` for every result — the FIRST
   * state asked for, regardless of where the business actually is. On a
   * "California, New York, Texas, Florida" search every lead was labelled
   * California, including the New York ones, so the state column was not
   * merely imprecise but wrong, and it made a working multi-state search
   * impossible to tell apart from a broken one.
   *
   * Stamped in discoverCandidates, which is the only place that knows which
   * state group issued the call. Null for the recheck channel, where the
   * company already has a state on file worth more than a re-derived guess.
   */
  state?: string | null;
  /**
   * Details Google Places returns with every place we ALREADY pay for, and
   * that were being discarded at the point of arrival.
   *
   * Zero of 106 companies in the database had a city — including zero of the
   * 68 found through Maps, where the full address and phone number came back
   * in the same $0.004 response as the website URL. A phone number for a
   * 60-year-old founder of a landscaping company is not a lesser contact than
   * an email; it is often the one that actually gets answered.
   *
   * Optional and only ever set by the maps channel; every other channel leaves
   * them undefined rather than guessing.
   */
  phone?: string | null;
  city?: string | null;
  address?: string | null;
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Whole TLDs that can never be a family-owned landscaping or building
// company. A live run off an alphabetical chamber-of-commerce list produced
// abac.edu (a college's staff page) and acecga.org (a trade association), each
// paid for at full classification price. A suffix rule catches every future
// college, agency and association at once, which an ever-growing host list
// never would.
const BLOCKED_TLDS = [".edu", ".gov", ".mil"];

// Every target is a US business, so a foreign country-code TLD is definitively
// the wrong company. A 20-phrasing discovery test surfaced an Australian
// newspaper (dailyliberal.com.au) and a UK university museum
// (merl.reading.ac.uk) as "new landscaping companies" — succession language
// like "joined her father" is journalism vocabulary worldwide.
//
// Stated as a RULE, not a list. The first version enumerated 26 ccTLDs, which
// is a list that is wrong the moment a run turns up the 27th — there are ~250,
// and nothing about ".mt" or ".co.il" makes it more of a US landscaper than
// ".com.au". Every ccTLD is two letters and no gTLD is, so "two-letter TLD"
// separates the two families exactly.
//
// The exceptions are the ccTLDs that stopped meaning their country: a handful
// sold generically that a US business plausibly registers. ".us" is the actual
// US ccTLD and obviously stays. Under-blocking on purpose, same trade as the
// publisher list below — a missed foreign site costs one classification call,
// a wrongly blocked company is a lead lost with no trace.
const GENERIC_TWO_LETTER_TLDS = new Set([
  "us", // the US ccTLD itself
  "co", // Colombia, sold generically, plenty of US small businesses use it
  "io",
  "ai",
  "me",
  "tv",
  "cc",
  "ly",
  "fm",
  "gg",
  "to",
  "sh",
  "so",
  "im",
  "st",
]);

export function isForeignTld(host: string): boolean {
  const tld = host.split(".").pop()?.toLowerCase() ?? "";
  return tld.length === 2 && /^[a-z]{2}$/.test(tld) && !GENERIC_TWO_LETTER_TLDS.has(tld);
}

// THE structural weakness of the succession-phrase web-search channel: those
// phrases appear in STORIES ABOUT family businesses far more often than on the
// businesses' own sites. The same test returned a funeral home, a legal
// directory, two trade magazines, a regional newspaper and Southern Living —
// only 2 of 12 sampled were actual landscaping companies. Each one otherwise
// costs a page fetch plus a full classification call to conclude "this is a
// magazine". Publishers are recognisable by name, so this is free to catch.
//
// Matched as a SUFFIX of the first domain label ("gadsdentimes", "nurserymag",
// "thecantoncitizen") because publisher names are compounds, not prefixes.
// The word list is deliberately conservative and errs toward UNDER-blocking:
// a missed magazine costs one classification call, while a wrongly blocked
// company is a lead lost forever with no trace. A first draft of this list
// included "inc" and blocked oceansidelandscapinginc.com — a real qualified
// lead with a verified contact — which is exactly the trade never to make.
// "press", "post" and "blog" are omitted for the same reason
// (pressurewashing…, fencepost…).
const MEDIA_SUFFIX_RE =
  /(news|times|tribune|herald|gazette|citizen|journal|chronicle|dispatch|observer|sentinel|ledger|courier|magazine|mag|weekly)$/i;
const MEDIA_HOST_RE =
  /^(southernliving|forbes|entrepreneur|bizjournals|patch|axios|avvo|justia|findlaw|crunchbase|dnb|zoominfo|apollo|rocketreach|signalhire|leadiq)\./i;

export function isBlocked(host: string): boolean {
  if (BLOCKED_TLDS.some((t) => host.endsWith(t))) return true;
  if (isForeignTld(host)) return true;
  if (MEDIA_HOST_RE.test(host)) return true;
  if (MEDIA_SUFFIX_RE.test(host.split(".")[0] ?? "")) return true;
  return BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));
}

async function runActorSync(actorId: string, input: Record<string, unknown>, timeoutSecs = 120) {
  const { token, capUsd } = await getApifyToken();
  await assertUnderBudget(token, capUsd);
  const url = `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`;

  // Retry transient failures. A real run lost its entire Maps channel to a
  // single 502 Bad Gateway — Apify's gateway hiccuping is not a statement
  // about whether California has landscapers, and losing a whole channel to
  // it both degrades the result and (via the warning line) misreports why.
  // Same policy as the OpenRouter client: 429/5xx/network only. A 4xx means
  // the request itself is wrong and will fail identically forever.
  const delays = [2000, 5000];
  let lastErr = "";
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch (e) {
      lastErr = `network error: ${(e as Error).message}`;
    }
    if (res?.ok) return res.json();

    if (res) {
      const body = await res.text().catch(() => "");
      lastErr = `${res.status} ${body.slice(0, 200)}`;
    }
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= delays.length) {
      throw new Error(`Apify actor ${actorId} failed: ${lastErr}`);
    }
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
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
// Places scraped per round, flat. This actor bills PER PLACE (~$0.004), and
// measured spend showed why a flat number matters: the previous
// `Math.min(60 * round, 360)` produced runs costing $0.24, $0.48, $0.72,
// $0.96, $1.20 across one search's five rounds.
//
// The reason that was pure waste: Google Maps has no "skip the first N"
// option. Asking round 2 for 120 places re-scrapes the same 60 round 1
// already bought, and excludeDomains only filters them out afterwards, in
// JavaScript — after the bill. That one search paid for 900 places to find
// 300 unique ones.
//
// 30 also comfortably feeds a round: ROUND_SIZE in the orchestrator is 15
// candidates, and Maps is one of three channels supplying them.
const MAPS_PLACES_PER_ROUND = 30;

/**
 * Fewest places worth buying for one trade term. Below this a query returns
 * too little to be worth its own actor run, so a tight budget spends on FEWER
 * terms rather than on all of them shallowly.
 */
const PER_TERM_MIN = 5;

// Rotating the LOCATION each round is what replaces scraping deeper. A
// different metro returns genuinely different businesses at the same cost,
// where a bigger `maxCrawledPlacesPerSearch` on the same query just re-buys
// the same ones. It also attacks pool exhaustion directly: a state-level
// query bottoms out around 23-80 companies, but its metros do not overlap.
const STATE_METROS: Record<string, string[]> = {
  CA: ["Los Angeles", "San Diego", "San Jose", "Sacramento", "Fresno", "Riverside", "Oakland", "Bakersfield"],
  TX: ["Houston", "Dallas", "San Antonio", "Austin", "Fort Worth", "El Paso", "Arlington", "Plano"],
  FL: ["Jacksonville", "Miami", "Tampa", "Orlando", "St. Petersburg", "Fort Lauderdale", "Naples", "Sarasota"],
  NY: ["New York", "Buffalo", "Rochester", "Syracuse", "Albany", "Yonkers", "White Plains", "Long Island"],
  NC: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Asheville"],
  GA: ["Atlanta", "Savannah", "Augusta", "Columbus", "Macon", "Athens"],
  OH: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton"],
  AZ: ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Gilbert"],
  CO: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Boulder"],
  TN: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Franklin"],
  WA: ["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue"],
  OR: ["Portland", "Salem", "Eugene", "Bend", "Medford"],
};

/**
 * The rotation for a nationwide search, one metro per discovery call.
 *
 * Ordered to spread across the country early rather than to rank by size: the
 * first six rounds land in six different regions, so a run that stops early
 * still returns a national spread instead of eight Californian results. Every
 * entry carries its state so the row records where the lead actually is.
 */
const NATIONAL_METROS: string[] = [
  "Los Angeles, California",
  "Dallas, Texas",
  "Atlanta, Georgia",
  "Chicago, Illinois",
  "Tampa, Florida",
  "Philadelphia, Pennsylvania",
  "Phoenix, Arizona",
  "Charlotte, North Carolina",
  "Denver, Colorado",
  "Seattle, Washington",
  "Nashville, Tennessee",
  "Columbus, Ohio",
  "Houston, Texas",
  "Minneapolis, Minnesota",
  "San Diego, California",
  "St. Louis, Missouri",
  "Orlando, Florida",
  "Kansas City, Missouri",
  "Salt Lake City, Utah",
  "Richmond, Virginia",
];

/**
 * Where round N should look. Rounds walk the metro list, then fall back to
 * the whole state once the metros are used up.
 */
function locationForRound(states: string[], round: number): string {
  // NATIONWIDE — no state was named, so rotate the biggest metros in the
  // country instead of asking Google Places for "United States".
  //
  // A geo search needs a place. Handing a country-sized string to a
  // place-search API is the one input it cannot do anything useful with: it
  // has no centre to search around, so it falls back on whatever it considers
  // nationally prominent, which is national chains and franchises — the exact
  // opposite of a family-owned business with a founder and a successor.
  //
  // Rotation matters at least as much. Walking metros is what stops the pool
  // drying up (see the MAPS comment above); a single fixed location has no
  // rotation axis at all, so round 2 re-buys round 1's results and the run
  // concludes there is nothing left after one call. "Anywhere" has to mean
  // "everywhere in turn", not "one query with no place in it".
  if (states.length === 0) {
    const metro = NATIONAL_METROS[(round - 1) % NATIONAL_METROS.length];
    return `${metro}, USA`;
  }
  // Multi-state searches alternate states first, so an early stop still
  // covered every state the user asked for rather than exhausting state one.
  const state = states[(round - 1) % states.length];
  const metros = STATE_METROS[state];
  const stateName = stateNameFor(state);
  if (!metros || metros.length === 0) return `${stateName}, USA`;
  const pass = Math.floor((round - 1) / states.length);
  if (pass >= metros.length) return `${stateName}, USA`;
  return `${metros[pass]}, ${stateName}, USA`;
}

/** One Google Places record, only the fields this pipeline reads. */
export interface RawPlace {
  title?: string;
  website?: string | null;
  categoryName?: string;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  state?: string | null;
}

/**
 * Google Places record -> Candidate.
 *
 * Separated out so the field names can be asserted against a REAL actor
 * payload in a test rather than trusted. They were originally written from
 * memory, and a wrong key here fails silently: the run still succeeds, the
 * companies still save, and the phone and address are simply never there —
 * which is exactly how zero of 106 rows ended up with a city.
 */
export function placeToCandidate(place: RawPlace): Candidate {
  return {
    domain: "",
    url: place.website!,
    title: place.title ?? "",
    channel: "maps",
    phone: place.phone ?? null,
    city: place.city ?? null,
    address: place.address ?? null,
  };
}

async function discoverViaMaps(
  industry: Industry | null,
  states: string[],
  limit: number,
  round: number,
  share = 1
): Promise<Candidate[]> {
  const allTerms = searchTermsFor(industry);
  const locationQuery = locationForRound(states, round);

  // The round budget, divided by however many states are being covered in
  // parallel (see `share` in discoverCandidates). Searching four states must
  // cost about what searching one costs, not four times as much.
  const placeBudget = Math.max(PER_TERM_MIN, Math.floor(MAPS_PLACES_PER_ROUND / share));

  // How many trade terms this call can afford AT A USEFUL DEPTH, then WHICH
  // ones. The old line was `perTerm = Math.max(5, floor(budget / terms))`,
  // and that floor made the budget a suggestion: an industry-less search has
  // ten terms, so it bought 10 x 5 = 50 places against a budget of 30. Under
  // a narrower per-state share it would have been far worse.
  //
  // Capping the term COUNT instead keeps the spend honest and each query deep
  // enough to be worth issuing. Rotating which terms by round means a narrow
  // budget still covers the whole trade family over several rounds rather than
  // re-buying "landscaping company" forever.
  const termCount = Math.max(1, Math.min(allTerms.length, Math.floor(placeBudget / PER_TERM_MIN)));
  const start = ((round - 1) * termCount) % allTerms.length;
  const searchTerms = Array.from(
    { length: termCount },
    (_, i) => allTerms[(start + i) % allTerms.length]
  );
  const perTerm = Math.max(1, Math.floor(placeBudget / searchTerms.length));
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
  )) as RawPlace[];

  // This actor bills per place scraped — meter what was actually returned.
  recordCost("apify_maps_place", items.length);

  return items
    .filter((place) => place.website)
    .map(placeToCandidate);
}

// Vertical-specific succession-language phrasings — the point of this
// channel isn't category coverage (Maps already has that), it's precision:
// surfacing companies whose own site or local press already uses the
// language of a real handoff, which a generic category listing can't do.
// Adjacent trades folded in via OR rather than as extra queries — this actor
// bills per SERP page, so covering tree service / irrigation / remodelers
// this way widens the trade family without increasing the query count.
//
// This is the channel that has actually earned its place: across four live
// test runs it produced 5 of the 5 succession signals found, outperforming
// both Maps and the directories. The mechanism is the whole lesson — QUERY
// THE SIGNAL, NOT THE CATEGORY. Maps can only ask "who is a landscaper in
// this metro"; these queries ask "who is already talking like a handoff
// happened." (Small n, and treated as such — what's being scaled here is the
// mechanism, not the 5/5 number.)
//
// ROTATION — why this is a LIST OF SETS and not three fixed queries.
// The orchestrator re-invokes discovery whenever its candidate buffer drains,
// passing an incrementing `round` (see `discoveryCalls` in orchestrator.ts).
// With three fixed queries, every one of those repeat calls re-ran the SAME
// SERP: the same ~100 results, all already in `seenDomains`, so the channel
// returned nothing fresh and the run concluded the pool was exhausted — while
// dozens of untried succession phrasings sat right there. That's the exact
// shape Maps hit before metro rotation (see locationForRound and the MAPS
// comment block above); same fix on a different axis. Maps rotates WHERE it
// looks, this rotates HOW it asks. A new phrasing buys a genuinely different
// SERP for the same one-page price; re-asking the old phrasing just re-buys
// the page already paid for.
//
// SET 1 IS THE PROVEN SET — those six strings are verbatim what produced the
// live-test hits. Do not reword them to fit a pattern; new phrasings belong
// in new sets, where a bad one costs one round instead of the channel.
export const SUCCESSION_QUERY_SETS: Record<Industry, string[][]> = {
  landscaping: [
    // Set 1 — proven in live testing. Verbatim, do not edit.
    [
      '"second generation" family owned landscaping OR "tree service" company',
      '"family owned" landscaping OR irrigation company "joined the business"',
      'father son landscaping OR "tree service" company "family business"',
    ],
    // Set 2 — generations further along, and the handoff stated as a past
    // event. "Second generation" is a self-description; "took over" is an
    // account of the transition itself, which tends to live in local press
    // and owner-letter pages Maps has no view of.
    [
      '"third generation" OR "3rd generation" landscaping OR "tree service" company',
      '"took over the family business" landscaping OR "lawn care" company',
      '"passed down" family owned landscaping OR irrigation company',
    ],
    // Set 3 — the relationship named explicitly, plus the longevity boast
    // ("...since 1978") that almost always sits next to a founder's name on
    // an About page.
    [
      '"son of founder" OR "daughter of founder" landscaping OR "tree service" company',
      '"family owned and operated since" landscaping OR irrigation company',
      '"my father started" OR "my grandfather started" landscaping OR "lawn care" company',
    ],
    // Set 4 — how the company describes the handoff when it's happening now
    // rather than already done: succession in progress, which is the moment
    // Jonathan's offer is actually relevant.
    [
      '"next generation of leadership" landscaping OR "tree service" company',
      '"carrying on the family tradition" landscaping OR irrigation company',
      '"joined his father" OR "joined her father" landscaping OR "lawn care" company',
    ],
  ],
  home_builder: [
    // Set 1 — proven in live testing. Verbatim, do not edit.
    [
      '"second generation" family owned home builder OR remodeler',
      '"family owned" custom home builder OR "general contractor" "joined the business"',
      'father son home builder OR remodeler "family business"',
    ],
    [
      '"third generation" OR "3rd generation" home builder OR remodeler',
      '"took over the family business" custom home builder OR "general contractor"',
      '"passed down" family owned home builder OR remodeler',
    ],
    [
      '"son of founder" OR "daughter of founder" home builder OR remodeler',
      '"family owned and operated since" custom home builder OR "general contractor"',
      '"my father started" OR "my grandfather started" home builder OR remodeler',
    ],
    [
      '"next generation of leadership" home builder OR remodeler',
      '"carrying on the family tradition" custom home builder OR "general contractor"',
      '"joined his father" OR "joined her father" home builder OR remodeler',
    ],
  ],
};

/**
 * Which phrasing set round N asks with. Wraps once the sets are used up —
 * by then the search has moved far enough (different state, and every domain
 * already returned is in the orchestrator's excludeDomains) that re-asking
 * set 1 is not the dead repeat it was when round 2 asked it.
 */
function successionSetForRound(sets: string[][], round: number): string[] {
  return sets[(round - 1) % sets.length];
}

export function successionTermsFor(industry: Industry | null, round: number): string[] {
  if (industry) return successionSetForRound(SUCCESSION_QUERY_SETS[industry], round);
  // No vertical picked — same pattern as before rotation: both verticals'
  // set for this round, merged. Query count is unchanged (6), so the SERP
  // page bill for an industry-less search is exactly what it always was.
  return [
    ...successionSetForRound(SUCCESSION_QUERY_SETS.landscaping, round),
    ...successionSetForRound(SUCCESSION_QUERY_SETS.home_builder, round),
  ];
}

// Channel B — targeted web search (apify/google-search-scraper) for
// succession-specific phrasing. Lower yield than Maps (this is raw web
// search, not a curated business index — listicles/directories/trade press
// show up alongside real hits) but catches companies a generic category
// search would never surface: local news features, "family business of the
// year" pieces, a company's own press page. isListicleTitle + BLOCKED_HOSTS
// filter the obvious noise; the classifier's own "not actually a company"
// check (see project memory) catches the rest at ~$0.01-0.02/candidate.
// Best-performing channel in live testing, and the one `round` matters most
// to — it selects the phrasing set, so a repeat call asks a different
// question instead of re-buying the same SERP (see SUCCESSION_QUERY_SETS).
// Still exactly one SERP page per query, before and after rotation.
async function discoverViaWebSearch(
  industry: Industry | null,
  states: string[],
  limit: number,
  round = 1,
  share = 1
): Promise<Candidate[]> {
  // Rotate which state this call covers — states[0] alone meant a
  // "Texas + Oklahoma" search never web-searched Oklahoma at all.
  const stateName = states.length > 0 ? stateNameFor(states[(round - 1) % states.length]) : "";
  // Note that on a multi-state search `round` drives BOTH rotations, so the
  // state and the phrasing set advance in lockstep: round 2 is state 2 asked
  // with set 2, and the pairings that come up repeat every lcm(states, sets)
  // rounds rather than covering the full grid. Left as-is on purpose. What
  // has to be new on each call is the PAIR, and it is — a long enough search
  // eventually re-asks an earlier pairing, which is a far smaller problem
  // than round 2 re-asking round 1's exact SERP, which is what happened
  // before. Decoupling the two indexes would be a change to state rotation,
  // and state rotation is not the thing that's broken.
  // Billed one SERP page per query, so the query COUNT is the cost. Divided
  // by how many states run in parallel this round (see `share`), which is what
  // keeps a four-state search from costing four times a one-state search.
  // Rotating the starting offset means the phrasings the budget cannot afford
  // this round are the ones it reaches for next round, rather than being
  // permanently unreachable.
  const allQueries = successionTermsFor(industry, round);
  const queryCount = Math.max(1, Math.min(allQueries.length, Math.floor(allQueries.length / share)));
  const qStart = ((round - 1) * queryCount) % allQueries.length;
  const queries = Array.from(
    { length: queryCount },
    (_, i) => allQueries[(qStart + i) % allQueries.length]
  )
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

  // Billed per SERP page: one page per query.
  recordCost("apify_serp_page", queries.split("\n").length);

  // No slice here — every organic result on the page is already paid for,
  // and the orchestrator's candidate buffer consumes surplus in later
  // rounds instead of re-billing a fresh search for it.
  return items
    .flatMap((page) => page.organicResults ?? [])
    .filter((r) => !isListicleTitle(r.title))
    .map((r) => ({ domain: "", url: r.url, title: r.title ?? "", channel: "web_search" as const }));
}

// Step 1 — discovery. FOUR channels run in parallel and get merged:
//   - directory (lib/pipeline/directory-discovery.ts) — highest-yield per the
//     Ofer Lieberson lesson, Claude+OpenRouter not Apify, gets cheaper over
//     time via the directory_sources cache. Listed FIRST so its candidates
//     win the `limit` cut when channels overlap.
//   - licensing (lib/pipeline/licensing-discovery.ts) — state contractor
//     licensing boards, the ground-truth universe of who may legally trade.
//     Costs nothing (free government downloads) and never re-bills, so it is
//     listed second: its candidates are the cheapest in the merge. Small in
//     v1 by design — boards publish names, not domains, and this channel only
//     emits rows that carry a domain of their own. See that file's header.
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
  round?: number; // 1-indexed, later rounds ask Maps for more places per
  // term so a repeat call surfaces businesses beyond what earlier rounds
  // already returned, rather than re-fetching the same top-ranked set.
  excludeDomains?: Set<string>;
}): Promise<{ candidates: Candidate[]; channelErrors: string[] }> {
  const { industry, states, limit, round = 1, excludeDomains } = params;

  // EVERY REQUESTED STATE, EVERY CALL — in parallel, sharing one budget.
  //
  // The state used to be picked by `locationForRound(states, round)`, one per
  // call, and `round` here is `discoveryCalls`, which only advances when the
  // orchestrator's candidate buffer EMPTIES. A single call that returned a
  // deep buffer therefore pinned the whole run to state one. That is not a
  // theory: a live "California, New York, Texas, Florida" run read 83
  // companies and every one of them was Californian. New York, Texas and
  // Florida were never searched at all, and nothing in the UI said so.
  //
  // Now each requested state gets its own set of channel calls, all issued
  // concurrently, with the per-round budget DIVIDED between them rather than
  // multiplied by them (see `share`). Four states cost about what one state
  // cost; each simply goes less deep per round, and depth accumulates over
  // rounds because the term and phrasing rotations advance independently.
  //
  // A single-state search is unchanged: one group, share of 1, same budget.
  const groups = states.length > 1 ? states.map((s) => [s]) : [states];
  const share = groups.length;
  const perGroupLimit = Math.max(1, Math.ceil(limit / share));

  const settled = await Promise.allSettled(
    groups.flatMap((group) => [
      discoverViaDirectories(industry, group, perGroupLimit, round),
      discoverViaLicensing(industry, group, perGroupLimit, round),
      discoverViaWebSearch(industry, group, perGroupLimit, round, share),
      discoverViaMaps(industry, group, perGroupLimit, round, share),
    ])
  );

  // Rebuilt per channel across all state groups, so "did the web search
  // channel work" still has a single answer even though it now ran four
  // times. A channel counts as failed only when it failed for EVERY state —
  // one state's timeout must not condemn a channel that worked elsewhere.
  const CHANNELS = ["Directory", "Licensing", "Web search", "Maps"] as const;
  const channelErrors: string[] = [];
  const raw: Candidate[] = [];
  const failedEverywhere: boolean[] = [];

  for (let ch = 0; ch < CHANNELS.length; ch++) {
    const forChannel = groups.map((_, g) => settled[g * CHANNELS.length + ch]);
    const ok = forChannel.filter((r) => r.status === "fulfilled");
    // Stamp the state of the group that issued the call. This is the only
    // point in the pipeline that still knows it — by the time a candidate
    // reaches the orchestrator the groups have been merged into one list.
    forChannel.forEach((r, g) => {
      if (r.status !== "fulfilled") return;
      const stateOfGroup = groups[g].length === 1 ? groups[g][0] : null;
      raw.push(...r.value.map((c) => ({ ...c, state: c.state ?? stateOfGroup })));
    });

    failedEverywhere.push(ok.length === 0);
    if (ok.length === 0) {
      const first = forChannel[0] as PromiseRejectedResult;
      channelErrors.push(
        `${CHANNELS[ch]} channel failed: ${first?.reason?.message?.slice(0, 150) ?? first?.reason}`
      );
    } else if (ok.length < forChannel.length) {
      const failed = forChannel
        .map((r, g) => (r.status === "rejected" ? groups[g].join("/") : null))
        .filter(Boolean);
      channelErrors.push(`${CHANNELS[ch]} channel failed for ${failed.join(", ")} only`);
    }
  }

  const [dirFailed, , webFailed, mapsFailed] = failedEverywhere;

  // Deliberately still the THREE searching channels, not all four. Licensing
  // returns [] rather than throwing for a state with no free enumerable source
  // — which is most states — so folding it into this AND would mean a run where
  // every key is dead but the search happened to be for Texas fulfils quietly
  // with zero candidates instead of raising. That silent-partial-answer failure
  // is the exact thing channel-health.ts exists to prevent. A licensing
  // rejection still lands in channelErrors above and surfaces as a warning.
  if (dirFailed && webFailed && mapsFailed) {
    throw new Error(channelErrors.join(" | "));
  }

  const seen = new Set<string>(excludeDomains ?? []);
  const candidates: Candidate[] = [];
  for (const r of raw) {
    const host = hostnameOf(r.url);
    if (!host || isBlocked(host) || seen.has(host)) continue;
    seen.add(host);
    candidates.push({
      domain: host,
      url: r.url,
      title: r.title || host,
      channel: r.channel,
      state: r.state ?? null,
      phone: r.phone ?? null,
      city: r.city ?? null,
      address: r.address ?? null,
    });
  }

  // NO cut at `limit` here — everything above was already paid for (Maps
  // bills per place, the SERP per page, directory extraction per Haiku
  // call), and cutting used to throw the surplus away and re-bill a fresh
  // discovery for it next round. The orchestrator's candidate buffer now
  // consumes these at its own pace; `limit` only sizes the per-channel
  // harvests above.
  return { candidates, channelErrors };
}

export interface FetchedPage {
  domain: string;
  url: string;
  text: string;
  siteName: string | null; // og:site_name, the cleanest source for the real company name
}

// Fetches one arbitrary, already-known URL (not a company's guessed
// About-page slugs — a specific directory/listing page). Used by
// directory-discovery.ts's cache-hit path: once a directory URL is known,
// re-fetching it directly is cheap (this) vs. the expensive web-search call
// that found it the first time.
export async function fetchSingleUrl(url: string): Promise<string | null> {
  let items: RawFetchedItem[];
  try {
    recordCost("apify_crawler_run");
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
  recordCost("apify_crawler_run");
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
    90 // raised from 60, one hop means up to 5 more pages per domain.
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

// Entities survive in attribute values (og:site_name) even though htmlToText
// decodes them in body text — which is how a company reached the UI displayed
// as "Father &amp; Son YYC". Shared so both paths decode identically.
export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&(?:ldquo|rdquo);/g, '"')
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function ogSiteNameFrom(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  return m?.[1] ? decodeEntities(m[1]).trim() : null;
}

interface FreeFetchAttempt {
  hit: { page: FetchedPage; teamLinks: string[] } | null;
  // TRUE the moment any HTTP response arrives, even a 404 — that separates
  // "site exists but is picky/JS-gated" (worth paying Firecrawl/Apify for)
  // from "DNS dead / connection refused" (nothing downstream can help).
  sawHttp: boolean;
}

async function freeFetchOne(url: string): Promise<FreeFetchAttempt> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": FREE_FETCH_UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(FREE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { hit: null, sawHttp: true };
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return { hit: null, sawHttp: true };
    const html = await res.text();
    const text = htmlToText(html);
    // A JS-rendered shell yields almost no text — treat that as a miss so the
    // Apify fallback (which renders) gets its turn, rather than passing an
    // empty page to an expensive classify call.
    if (text.length < 400) return { hit: null, sawHttp: true };
    const host = hostnameOf(res.url) ?? hostnameOf(url);
    if (!host) return { hit: null, sawHttp: true };
    return {
      hit: {
        page: { domain: host, url: res.url || url, text, siteName: ogSiteNameFrom(html) },
        teamLinks: extractTeamLinks(html, res.url || url),
      },
      sawHttp: true,
    };
  } catch {
    return { hit: null, sawHttp: false };
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
async function freeFetchDomain(
  domain: string
): Promise<{ pages: FetchedPage[] | null; sawHttp: boolean }> {
  const seeded = await Promise.all(
    ABOUT_SLUGS.map((slug) => freeFetchOne(`https://${domain}/${slug}`))
  );
  const sawHttp = seeded.some((r) => r.sawHttp);
  const hits = seeded
    .map((r) => r.hit)
    .filter((r): r is { page: FetchedPage; teamLinks: string[] } => r !== null);
  if (hits.length === 0) return { pages: null, sawHttp };

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
    if (r.hit) pages.push(r.hit.page);
  });
  return { pages, sawHttp: true };
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
    if (free.pages) {
      byDomain.set(domain, free.pages);
      return;
    }

    // DEAD-DOMAIN FAST PATH — every seeded request failed at the network
    // level (DNS, connection refused, timeout): the site is down, not picky.
    // Firecrawl and Apify fetch the same internet; paying them to re-confirm
    // a dead domain burned 2 render credits + a crawler run + ~3 minutes of
    // wall-clock per dead domain, to learn nothing the first 8 seconds
    // hadn't already said. The company is recorded as unfetchable with a
    // 14-day recheck either way.
    if (!free.sawHttp) {
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
