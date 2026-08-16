import { resolveSetting } from "../settings";
import { recordCost } from "./cost-tracker";

// Tavily — search priced as SEARCH, not as LLM tokens.
//
// Replaces the OpenRouter ":online" calls the directory channel used to make.
// Why that mattered: ":online" bundles search into the model call, so every
// fetched result gets injected into the prompt at full size — one measured
// call ran 19,425 prompt tokens for a *simple* query. Directory lookups that
// read listing pages ran far bigger. Reconstructed from a day's spend,
// directory discovery accounted for roughly $26 of a $30 OpenRouter balance
// (~$0.50/call), against ~$2 for all the actual classification work.
//
// Here the search costs ~$0.008 and returns already-extracted content, and we
// decide how much of it to hand the model. Search and reasoning are billed
// separately again, which is the whole point.
const TAVILY_BASE = "https://api.tavily.com";

export async function getTavilyKey(): Promise<string | null> {
  return resolveSetting("TAVILY_API_KEY", process.env.TAVILY_API_KEY);
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

/**
 * Returns [] rather than throwing when unconfigured or failing — every caller
 * treats Tavily as one option among several, so a Tavily outage should quietly
 * fall through to the next source, never take a search down.
 *
 * Quietly to the CALLER, loudly to the log. This used to swallow every failure
 * without a word, which made a dead angle and a healthy-but-empty one look
 * identical from the outside: four searches metered, four candidates found, and
 * no way to tell whether Tavily had answered at all. Never do that again — a
 * failed lookup costs a whole directory angle for that search.
 */
/**
 * Why the last search returned nothing, when it returned nothing.
 *
 * "Tavily searched and found no directory" and "Tavily could not be reached"
 * are the same empty array to the caller, and they mean opposite things: the
 * first is a fact about Georgia, the second is a fact about our account. With
 * no way to tell them apart the directory channel could go completely dark —
 * out of credit, revoked key, an outage — and the run would simply report
 * fewer companies, with nothing anywhere saying a whole channel never looked.
 *
 * Firecrawl cannot cover this. It RENDERS a page once you know its URL; it
 * does not SEARCH. Tavily is the only thing that answers "which page lists
 * these companies", so when it is down that channel has no fallback and the
 * only honest response is to say so.
 */
export type TavilyFailure = "no_key" | "unreachable" | "rate_limited" | null;
let lastFailure: TavilyFailure = null;

/** Reads and clears the reason the most recent search failed, if it did. */
export function takeTavilyFailure(): TavilyFailure {
  const f = lastFailure;
  lastFailure = null;
  return f;
}

export async function tavilySearch(
  query: string,
  opts: {
    maxResults?: number;
    depth?: "basic" | "advanced";
    includeRaw?: boolean;
  } = {}
): Promise<TavilyResult[]> {
  const key = await getTavilyKey();
  if (!key) {
    lastFailure = "no_key";
    return [];
  }

  const body = JSON.stringify({
    query,
    max_results: opts.maxResults ?? 8,
    // "basic" is 1 credit, "advanced" 2. Basic has been enough for
    // "which directory lists these companies" — don't pay double by default.
    search_depth: opts.depth ?? "basic",
    include_raw_content: opts.includeRaw ?? false,
    // Every target is a US business. `country` boosts US-hosted results, and
    // Tavily only honours it when `topic` is "general" — which is the default,
    // but stating it explicitly is what makes `country` take effect rather
    // than being silently ignored.
    //
    // This is a RANKING nudge, not a filter: Tavily will still return a
    // Canadian trade association if it is the best match. The hard cut stays
    // isForeignTld() in apify.ts. What this buys is that the 6 results an
    // angle actually pays to consider are more likely to be the US ones —
    // the difference between filtering foreign hits and not surfacing them.
    topic: "general",
    country: "united states",
  });

  // Retry transient failures only, same policy and shape as openrouter.ts's
  // chat() and apify.ts's runActorSync(). Measured live: four angles fired
  // concurrently (the real Promise.all burst) all returned 200 in ~320ms with
  // no rate-limit headers, so the angles are deliberately NOT serialized —
  // that would quadruple discovery latency to fix a 429 that doesn't happen.
  // This is just insurance for the blip that used to vanish silently.
  const delays = [1000, 3000];
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let networkErr = "";
    try {
      res = await fetch(`${TAVILY_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      networkErr = `${(e as Error).name}: ${(e as Error).message}`;
    }

    if (res?.ok) {
      lastFailure = null;
      // Meter only a response that actually came back — the counter is meant
      // to answer "what did this run BUY", and an attempt that 4xx'd or timed
      // out bought nothing. Recording before the fetch inflated every run's
      // search count by however many calls failed, with no trace of which.
      recordCost("tavily_search");
      try {
        const data = await res.json();
        return Array.isArray(data?.results) ? (data.results as TavilyResult[]) : [];
      } catch (e) {
        console.warn(`Tavily search returned unparseable JSON for "${query.slice(0, 80)}": ${(e as Error).message}`);
        return [];
      }
    }

    const retryable = !res || res.status === 429 || res.status >= 500;
    if (retryable && attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt] + Math.floor(Math.random() * 300)));
      continue;
    }

    lastFailure = res && (res.status === 429 || res.status === 402) ? "rate_limited" : "unreachable";
    if (res) {
      const errBody = await res.text().catch(() => "");
      console.warn(
        `Tavily search failed: ${res.status} ${errBody.slice(0, 200)}, query "${query.slice(0, 80)}"`
      );
    } else {
      console.warn(`Tavily search failed: ${networkErr}, query "${query.slice(0, 80)}"`);
    }
    return [];
  }
}
