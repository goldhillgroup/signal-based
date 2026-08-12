/**
 * A search can target SEVERAL verticals at once.
 *
 * "Landscaping and HVAC" is a reasonable thing to ask for, and used to mean two
 * separate runs, two folders, and two lots of discovery spend over the same
 * geography. Verticals being mutually exclusive was an artefact of there having
 * been two of them; the ICP names eight.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { successionTermsFor, refinementQueries } from "../lib/pipeline/apify.js";
import { bindsThisSearch } from "../lib/pipeline/orchestrator.js";
import { INDUSTRY_META } from "../lib/signal-meta.js";
import type { Industry } from "../lib/supabase/types.js";

test("a mixed selection asks about every vertical picked", () => {
  const mixed = successionTermsFor(["landscaping", "trades"], 1).join(" ").toLowerCase();
  assert.match(mixed, /landscap/, "landscaping was dropped");
  assert.match(mixed, /plumb|electric|hvac/, "the trades were dropped");
});

test("no selection means every vertical, not the original two", () => {
  // The old code merged landscaping + home_builder for the empty case, which
  // was right when those were the only two and silently wrong at eight.
  const seen = new Set<string>();
  for (let round = 1; round <= 8; round++) {
    for (const q of successionTermsFor([], round)) seen.add(q);
  }
  const all = [...seen].join(" ").toLowerCase();
  for (const [needle, vertical] of [
    [/landscap/, "landscaping"],
    [/home builder|custom home/, "home_builder"],
    [/plumb|electric|hvac/, "trades"],
    [/manufactur|fabricat|machine shop/, "manufacturing"],
    [/distribut|wholesale|supply/, "distribution"],
    [/pest control|janitorial|facility/, "property_services"],
  ] as [RegExp, string][]) {
    assert.match(all, needle, `${vertical} is never asked about across 8 rounds`);
  }
});

test("cost does not scale linearly with the number picked", () => {
  // Each vertical contributes three queries per round at ~$0.0035 a SERP page.
  // Without a cap, selecting all eight would quadruple the bill of every
  // discovery call, on every round.
  const one = successionTermsFor(["landscaping"], 1).length;
  const all = successionTermsFor([], 1).length;
  assert.ok(all <= one * 3, `one vertical buys ${one} queries, all eight buys ${all}`);
});

test("a wide selection still reaches every vertical across rounds", () => {
  const picked: Industry[] = ["landscaping", "trades", "manufacturing", "distribution", "construction"];
  const seen = new Set<string>();
  for (let round = 1; round <= picked.length; round++) {
    for (const q of successionTermsFor(picked, round)) seen.add(q);
  }
  const all = [...seen].join(" ").toLowerCase();
  assert.match(all, /landscap/);
  assert.match(all, /plumb|electric|hvac/);
  assert.match(all, /manufactur|fabricat/);
  assert.match(all, /distribut|wholesale/);
});

test("the signal focus is anchored to each selected trade", () => {
  const qs = refinementQueries("founder retiring", ["landscaping", "trades"]).join(" ").toLowerCase();
  assert.match(qs, /founder retiring/);
  assert.match(qs, /landscap/);
  assert.match(qs, /plumb|electric|hvac/);
});

test("an industry rejection only binds a search that includes that vertical", () => {
  const cut = { status: "rejected", rejection_reason: "Wrong industry — an HVAC contractor.", industry: "trades" };
  // A landscaping-only search has no business being bound by a trades verdict.
  assert.equal(bindsThisSearch(cut, ["landscaping"], undefined), false);
  // A search that includes trades is.
  assert.equal(bindsThisSearch(cut, ["landscaping", "trades"], undefined), true);
  // And "all verticals" is bound by everything.
  assert.equal(bindsThisSearch(cut, [], undefined), true);
});

test("every vertical in the ICP can actually be selected", () => {
  for (const key of Object.keys(INDUSTRY_META) as Industry[]) {
    assert.ok(successionTermsFor([key], 1).length > 0, `${key} produces no queries`);
  }
});
