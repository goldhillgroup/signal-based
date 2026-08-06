import { resolveSetting } from "../settings";

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
 */
export async function tavilySearch(
  query: string,
  opts: { maxResults?: number; depth?: "basic" | "advanced"; includeRaw?: boolean } = {}
): Promise<TavilyResult[]> {
  const key = await getTavilyKey();
  if (!key) return [];

  try {
    const res = await fetch(`${TAVILY_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        max_results: opts.maxResults ?? 8,
        // "basic" is 1 credit, "advanced" 2. Basic has been enough for
        // "which directory lists these companies" — don't pay double by default.
        search_depth: opts.depth ?? "basic",
        include_raw_content: opts.includeRaw ?? false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.results) ? (data.results as TavilyResult[]) : [];
  } catch {
    return [];
  }
}
