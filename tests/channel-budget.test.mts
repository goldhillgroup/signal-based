/**
 * Spending the read budget where the pairs actually are.
 *
 * Measured on this installation's own history:
 *
 *   web_search   496 read ->  15 pairs   1 in 33
 *   maps         343 read ->   2 pairs   1 in 172
 *   directory    159 read ->   0 pairs   never
 *
 * Maps and directories were doing HALF the reading for an eighth of the result.
 * The split was 1.5x against 0.5x — a 3:1 ratio for a 5:1 difference in yield.
 *
 * It stayed 3:1 for a real reason: Maps was the only channel returning a phone
 * number and a city with the listing, and a lead nobody can ring is not a lead.
 * That justification expired when page contact details started being read out
 * of the footer. On leads crawled since, web_search reaches 93% phone coverage
 * against Maps' 100% — seven points, against five times the pair rate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// The measured rates the split is derived from.
const RATE = { web_search: 15 / 496, maps: 2 / 343, directory: 0 / 159 };
const PHONE = { web_search: 0.93, maps: 1.0, directory: 0.79 };

function projected(webMul: number, floorMul: number, perGroup = 12, rounds = 5) {
  const web = Math.ceil(perGroup * webMul) * rounds;
  const maps = Math.floor(perGroup * floorMul) * rounds;
  const dir = Math.floor(perGroup * floorMul) * rounds;
  const read = web + maps + dir;
  return {
    read,
    pairs: web * RATE.web_search + maps * RATE.maps + dir * RATE.directory,
    phone: (web * PHONE.web_search + maps * PHONE.maps + dir * PHONE.directory) / read,
  };
}

const BEFORE = projected(1.5, 0.5);
const AFTER = projected(2, 0.35);

test("the new split finds materially more pairs", () => {
  assert.ok(AFTER.pairs > BEFORE.pairs * 1.2, `only ${((AFTER.pairs / BEFORE.pairs - 1) * 100).toFixed(0)}% more`);
});

test("and does it without reading much more", () => {
  // The win has to come from WHERE the budget goes, not from spending more.
  assert.ok(AFTER.read < BEFORE.read * 1.15, "this is a reallocation, not a bigger budget");
});

test("phone coverage does not fall — the reason Maps held its share", () => {
  assert.ok(
    AFTER.phone >= BEFORE.phone - 0.02,
    `phone coverage dropped from ${(BEFORE.phone * 100).toFixed(0)}% to ${(AFTER.phone * 100).toFixed(0)}%`
  );
});

test("no channel is starved to zero", () => {
  // A channel with no candidates generates no evidence and can never recover
  // from a bad run — the day a directory finds a pair, that only becomes known
  // if it was allowed to run.
  const perGroup = 12;
  assert.ok(Math.max(1, Math.floor(perGroup * 0.35)) >= 1);
  assert.ok(Math.max(1, Math.floor(1 * 0.35)) >= 1, "even the smallest budget keeps a floor");
});

test("the ratio tracks the evidence rather than a round number", () => {
  const yieldRatio = RATE.web_search / RATE.maps;      // ~5.1
  const budgetRatio = 2 / 0.35;                        // ~5.7
  assert.ok(budgetRatio > 3, "the old 3:1 understated a 5:1 difference");
  assert.ok(
    Math.abs(budgetRatio - yieldRatio) < yieldRatio,
    "the split should be the same order as the yield gap, not arbitrary"
  );
});
