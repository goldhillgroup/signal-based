/**
 * "State licensing boards failed. Results may be incomplete" on a California
 * search for PROFESSIONAL SERVICES. The board simply does not license that
 * trade; the loader built an empty class list, `[].every(...)` is true, and it
 * threw instead of returning nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardLicenses, discoverViaLicensing } from "../lib/pipeline/licensing-discovery.js";

test("a board only claims the trades it licenses", () => {
  assert.equal(boardLicenses("CA", "landscaping"), true);
  assert.equal(boardLicenses("CA", "home_builder"), true);
  assert.equal(boardLicenses("CA", "trades"), true);
  assert.equal(boardLicenses("CA", "professional_services"), false);
  assert.equal(boardLicenses("CA", "manufacturing"), false);
  assert.equal(boardLicenses("CA", "distribution"), false);
  assert.equal(boardLicenses("WA", "professional_services"), false);
  assert.equal(boardLicenses("OR", "professional_services"), false);
  assert.equal(boardLicenses("OR", "landscaping"), true);
});

test("no vertical chosen still means the default pair", () => {
  assert.equal(boardLicenses("CA", null), true);
});

test("a state with no board source covers nothing", () => {
  assert.equal(boardLicenses("TX", "landscaping"), false);
});

test("an unlicensed trade returns NOTHING instead of throwing", async () => {
  // This is the regression. It must resolve to an empty list, with no network.
  for (const trade of ["professional_services", "manufacturing", "distribution"] as const) {
    for (const state of ["CA", "WA", "OR"]) {
      const out = await discoverViaLicensing(trade, [state], 10, 1);
      assert.deepEqual(out, [], `${state} ${trade} must be a quiet empty result, not a failure`);
    }
  }
});
