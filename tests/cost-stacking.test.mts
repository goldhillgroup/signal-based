import { test } from "node:test";
import assert from "node:assert/strict";
import { stackCost, type CostCounters } from "../lib/pipeline/cost-tracker.js";

const pass = (counts: CostCounters["counts"]): CostCounters => ({ counts });

test("a later pass adds to the cost already on the row instead of replacing it", () => {
  const first = stackCost(null, null, pass({ classify_call: 50 })); // 50 x 0.012 = 0.60
  assert.equal(first.cost_estimate_usd, 0.6);
  const second = stackCost(first.cost_estimate_usd, first.cost_breakdown, pass({ classify_call: 25 })); // +0.30
  assert.equal(second.cost_estimate_usd, 0.9);
  assert.equal(second.cost_breakdown, "50 classify/disprove · 25 classify/disprove");
});

test("a pass that spent nothing leaves the row as it was, with no dangling separator", () => {
  const r = stackCost(1.234, "10 classify/disprove", pass({}));
  assert.equal(r.cost_estimate_usd, 1.234);
  assert.equal(r.cost_breakdown, "10 classify/disprove");
});

test("a first pass with nothing recorded yet starts from zero, and an empty first pass has no breakdown", () => {
  assert.deepEqual(stackCost(undefined, undefined, pass({})), { cost_estimate_usd: 0, cost_breakdown: null });
});

test("float noise from adding rounded values is rounded away", () => {
  const r = stackCost(0.1, null, pass({ classify_call: 17 })); // 0.1 + 0.204
  assert.equal(r.cost_estimate_usd, 0.304);
});

test("a numeric column that comes back as a string is still added, not concatenated", () => {
  const r = stackCost("0.5" as unknown as number, null, pass({ classify_call: 1 }));
  assert.equal(r.cost_estimate_usd, 0.512);
});
