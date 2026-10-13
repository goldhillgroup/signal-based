import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCounts } from "../lib/pipeline/search-counts.js";

const r = (status: string, has_signal: boolean | null = false, confidence: string | null = null) => ({ status, has_signal, confidence });

test("pairs split by confidence, fits and cuts counted apart", () => {
  const c = searchCounts([r("qualified", true, "high"), r("qualified", true, "medium"), r("qualified", true, "verify"), r("qualified", false), r("qualified", null), r("rejected"), r("rejected")]);
  assert.deepEqual(c, { qualified_count: 2, verify_count: 1, fit_only_count: 2, rejected_count: 2 });
});

test("a fit-only lead retired by a newer search moves from fit-only to rejected", () => {
  // The August folder that said 5 fit-only and 7 cut while holding 4 and 8.
  const before = searchCounts([r("qualified", false), r("qualified", false), r("rejected")]);
  const after = searchCounts([r("qualified", false), r("rejected"), r("rejected")]);
  assert.equal(before.fit_only_count - after.fit_only_count, 1);
  assert.equal(after.rejected_count - before.rejected_count, 1);
});

test("an empty folder is all zeros", () => {
  assert.deepEqual(searchCounts([]), { qualified_count: 0, verify_count: 0, fit_only_count: 0, rejected_count: 0 });
});
