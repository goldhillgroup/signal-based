/**
 * What each metered thing costs, and the one derived figure the UI quotes.
 *
 * SEPARATE FROM cost-tracker.ts ON PURPOSE. That module owns an
 * AsyncLocalStorage, which is `node:async_hooks` — a Node built-in. The confirm
 * dialogs are client components, so importing the price from there pulled
 * async_hooks into the browser bundle and the build failed outright with
 * "the chunking context does not support external modules". Prices are plain
 * numbers and belong somewhere both sides can read.
 */

export const UNIT_USD = {
  classify_call: 0.012,
  disprove_call: 0.012,
  extract_call: 0.002,
  intake_call: 0.001,
  tavily_search: 0.008,
  firecrawl_scrape: 0.01,
  apify_maps_place: 0.004,
  apify_serp_page: 0.0035,
  apify_crawler_run: 0.013,
  anymailfinder_lookup: 0.05,
  millionverifier_check: 0.006,
} as const;

/**
 * The worst case for ONE company in an enrichment pass — the number behind the
 * "costs up to $N" line in every confirm dialog.
 *
 * It was hardcoded 0.05 in three separate places and described as
 * "AnymailFinder's rate, billed only on a find". True as far as it went, and
 * not a ceiling: every address that IS found is then checked against
 * MillionVerifier. So the one line whose entire job is to state the maximum
 * before money moves was quoting less than a successful lookup actually costs.
 *
 *   anymailfinder_lookup 0.05 + millionverifier_check 0.006 = 0.056
 *
 * The page-crawl fallback (0.013) only runs when the paid lookup FAILED, and a
 * failed lookup is not billed, so it can never stack on top of the above.
 */
export const ENRICH_CEILING_PER_COMPANY_USD =
  UNIT_USD.anymailfinder_lookup + UNIT_USD.millionverifier_check;
