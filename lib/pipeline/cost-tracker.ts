import { AsyncLocalStorage } from "node:async_hooks";
import { UNIT_USD } from "./pricing";

/**
 * Per-search cost metering.
 *
 * Rule this exists to enforce: you can't optimize what you can't see. Every
 * cost decision so far (":online" burning $26/day, Maps re-buying the same
 * places at $0.24→$1.20 per round) was invisible until someone went digging
 * through vendor dashboards after the money was gone. This makes each
 * search's spend a number on the search row, visible the moment the run
 * finishes.
 *
 * Mechanism: AsyncLocalStorage, so the vendor modules (tavily/firecrawl/
 * apify/openrouter/anymailfinder/millionverifier) can record usage without
 * every function in the pipeline having to thread a searchId through its
 * signature. When no store is active (evals, one-off scripts), recording is a
 * silent no-op.
 *
 * The dollar figures are ESTIMATES from measured per-unit prices, labeled as
 * such in the UI — the point is relative visibility ("this search cost ~9x
 * the last one, why?"), not accounting-grade precision.
 */

// Measured/observed per-unit prices (USD). Sources: Apify runs list on token
// 4 (maps $0.004/place, crawler ~$0.013/run, SERP ~$0.0035/page), Tavily's
// $0.008/basic search, Firecrawl ~$0.01/scrape at paid-tier pricing, and
// OpenRouter per-call costs measured with prompt caching on (classify/
// disprove on Sonnet ≈ $0.012 with the 12k-char page dominating input;
// extract on Haiku ≈ $0.002).
//
// Enrichment (the second, manually-triggered step) is priced the same way:
// AnymailFinder's plans work out to roughly $0.05 per email at the volumes
// this account buys, and they only bill on a FOUND address — so the unit is
// recorded per successful find, never per attempt (see anymailfinder.ts).
// MillionVerifier is ~$0.006 per single-email check. Both are ESTIMATES, same
// caveat as everything above: the number exists for relative comparison, not
// for the books.


export type CostUnit = keyof typeof UNIT_USD;

export interface CostCounters {
  counts: Partial<Record<CostUnit, number>>;
}

const als = new AsyncLocalStorage<CostCounters>();

/** Record `n` units of a metered thing against the active search, if any. */
export function recordCost(unit: CostUnit, n = 1): void {
  const store = als.getStore();
  if (!store || n <= 0) return;
  store.counts[unit] = (store.counts[unit] ?? 0) + n;
}

/**
 * Run `fn` with the given counters active. The caller keeps the reference,
 * so totals are readable from inside `fn` (e.g. to write the final search
 * row while the run is still the active store) as well as after.
 */
export async function runWithCounters<T>(counters: CostCounters, fn: () => Promise<T>): Promise<T> {
  return als.run(counters, fn);
}

export function estimateUsd(counters: CostCounters): number {
  let total = 0;
  for (const [unit, n] of Object.entries(counters.counts)) {
    total += (UNIT_USD[unit as CostUnit] ?? 0) * (n ?? 0);
  }
  return Math.round(total * 1000) / 1000;
}

/** Compact human line for the search row: "12 classify · 30 maps places · ~$0.31". */
export function describeCost(counters: CostCounters): string {
  const c = counters.counts;
  const parts: string[] = [];
  const llm = (c.classify_call ?? 0) + (c.disprove_call ?? 0);
  if (llm) parts.push(`${llm} classify/disprove`);
  if (c.extract_call) parts.push(`${c.extract_call} extract`);
  if (c.tavily_search) parts.push(`${c.tavily_search} searches`);
  // Was MISSING (found 2026-08-07). apify_serp_page is metered and priced, so
  // estimateUsd always counted it — but describeCost never emitted it, which
  // made the human-readable line omit the succession web-search channel
  // entirely. That line is the only per-vendor record kept per run, so any
  // analysis built from it scored the highest-yield channel at zero spend.
  // The totals were never wrong; every breakdown of them was.
  if (c.apify_serp_page) parts.push(`${c.apify_serp_page} SERP pages`);
  if (c.firecrawl_scrape) parts.push(`${c.firecrawl_scrape} renders`);
  if (c.apify_maps_place) parts.push(`${c.apify_maps_place} map places`);
  if (c.apify_crawler_run) parts.push(`${c.apify_crawler_run} crawls`);
  // Enrichment units — appended to the discovery line when the enrich step
  // runs, so one search row reads end-to-end: "12 classify/disprove · 30 map
  // places · 3 email lookups · 5 verifications".
  if (c.anymailfinder_lookup) parts.push(`${c.anymailfinder_lookup} email lookups`);
  if (c.millionverifier_check) parts.push(`${c.millionverifier_check} verifications`);
  return parts.join(" · ");
}
