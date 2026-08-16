/**
 * Spending the read budget where the pairs actually are.
 *
 * The headline number this exists to move: 1 confirmed founder-and-successor
 * pair per 47 companies read. Measured per channel on 852 of this
 * installation's own reads:
 *
 *   web_search   441 read ->  16 pairs   1 in 28
 *   maps         303 read ->   2 pairs   1 in 152
 *   directory    106 read ->   0 pairs   never
 *
 * Every channel bought the same number of candidates and only the READ ORDER
 * was yield-aware, while a fixed quarter of every batch was reserved for
 * exploring channels whose answer was already known.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { explorationFor, orderByYield } from "../lib/pipeline/channel-priors.js";
import type { Candidate } from "../lib/pipeline/apify.js";

const c = (channel: Candidate["channel"], i: number) =>
  ({ domain: `d${i}.com`, url: `https://d${i}.com`, channel }) as Candidate;

test("exploration shrinks as evidence accumulates, and never to zero", () => {
  const day1 = explorationFor(0);
  const later = explorationFor(852);
  const huge = explorationFor(100_000);
  assert.ok(day1 > later, "a settled estimate should not cost as much to re-check");
  assert.ok(later > huge, "and should keep shrinking");
  // Never zero: the ordering is otherwise a ratchet — a channel that has an
  // unlucky week sinks, stops being read, stops producing evidence, and can
  // never recover however good it is.
  assert.ok(huge > 0.05, `floor collapsed to ${huge}`);
  assert.ok(day1 <= 0.25 && day1 > 0.2, "day one should still explore properly");
});

test("with real rates, most of a batch goes to the best channel", () => {
  const rates = { web_search: 0.036, maps: 0.007, directory: 0.001, licensing: 0.01, recheck: 0.3, press: 0.05 };
  const batch = [
    ...Array.from({ length: 20 }, (_, i) => c("maps", i)),
    ...Array.from({ length: 20 }, (_, i) => c("web_search", 100 + i)),
  ];
  const ordered = orderByYield(batch, rates, explorationFor(852));
  const firstTen = ordered.slice(0, 10).filter((x) => x.channel === "web_search").length;
  assert.ok(firstTen >= 7, `only ${firstTen}/10 of the front of the batch is the best channel`);
});

test("the weakest channel still appears — a ranking, not a ratchet", () => {
  const rates = { web_search: 0.036, maps: 0.007, directory: 0.0, licensing: 0.01, recheck: 0.3, press: 0.05 };
  const batch = [
    ...Array.from({ length: 30 }, (_, i) => c("web_search", i)),
    ...Array.from({ length: 6 }, (_, i) => c("directory", 100 + i)),
  ];
  const ordered = orderByYield(batch, rates, explorationFor(852));
  assert.equal(ordered.length, batch.length, "nothing may be dropped");
  const firstDirectory = ordered.findIndex((x) => x.channel === "directory");
  assert.ok(firstDirectory >= 0, "a zero-yield channel must still be read sometimes");
  assert.ok(firstDirectory < batch.length - 1, "and not always dead last");
});

test("ordering never invents or loses a candidate", () => {
  const rates = { web_search: 0.036, maps: 0.007, directory: 0.001, licensing: 0.01, recheck: 0.3, press: 0.05 };
  for (const n of [0, 1, 2, 15, 40]) {
    const batch = Array.from({ length: n }, (_, i) => c(i % 2 ? "maps" : "web_search", i));
    const ordered = orderByYield(batch, rates, explorationFor(500));
    assert.equal(ordered.length, n);
    assert.equal(new Set(ordered.map((x) => x.domain)).size, n, "a candidate was duplicated");
  }
});
