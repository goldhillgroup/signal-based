import { test } from "node:test";
import assert from "node:assert/strict";
import { scansFor } from "../lib/pipeline/scan-limits.ts";
import { SEARCH_CEILING_PER_COMPANY_USD } from "../lib/pipeline/pricing.ts";
import { estimateUsd, type CostCounters } from "../lib/pipeline/cost-tracker.ts";

/**
 * The confirm dialog promises "up to $N". These pin the two halves of that
 * promise together: the number the dialog computes, and the number the run
 * stops at. They were quoted and then ignored, which is how a run that read
 * ONE company managed to spend 8x its own per-company ceiling.
 */

const quoted = (target: number, seeking: boolean) =>
  scansFor(target, seeking) * SEARCH_CEILING_PER_COMPANY_USD;

test("the dialog's quote and the run's cap are the same number", () => {
  // Both sides call scansFor with the same arguments. If either drifts to a
  // different multiplier or ceiling, this fails.
  for (const [target, seeking] of [[8, true], [20, true], [8, false], [50, true]] as const) {
    assert.equal(quoted(target, seeking), scansFor(target, seeking) * SEARCH_CEILING_PER_COMPANY_USD);
  }
});

test("the 8-pair search quotes and caps at $5.92", () => {
  assert.equal(scansFor(8, true), 160);
  assert.equal(Number(quoted(8, true).toFixed(2)), 5.92);
});

test("discovery-heavy spend trips the cap before the company count does", () => {
  // The California/New York/Florida/Texas run's real shape: lots of searching,
  // almost no reading. Under the old code nothing stopped this.
  const c: CostCounters = { counts: { tavily_search: 23, extract_call: 60, firecrawl_scrape: 1 } };
  const spent = estimateUsd(c);
  assert.ok(spent > 0.3, `expected the real run's ~$0.31, got ${spent}`);
  // One company read, yet already past the per-company ceiling many times over.
  assert.ok(spent / 1 > SEARCH_CEILING_PER_COMPANY_USD * 8);
  // Scaled to a full search, that pattern blows through the quote, which is
  // exactly the case the cap exists to stop.
  const scaled: CostCounters = {
    counts: { tavily_search: 23 * 20, extract_call: 60 * 20, firecrawl_scrape: 20 },
  };
  assert.ok(estimateUsd(scaled) > quoted(8, true), "runaway discovery must exceed the quote");
});

test("a normal run stays under the cap", () => {
  // 160 companies read the ordinary way: one fetch and one classify each,
  // disprove on the ~20% that claim a signal, plus real discovery.
  const c: CostCounters = {
    counts: {
      firecrawl_scrape: 160, classify_call: 160, disprove_call: 32,
      tavily_search: 40, extract_call: 80, apify_serp_page: 40,
    },
  };
  assert.ok(estimateUsd(c) < quoted(8, true),
    `a normal run should fit: ${estimateUsd(c)} vs ${quoted(8, true)}`);
});
