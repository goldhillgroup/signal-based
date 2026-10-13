/**
 * The default search stopped after one pass with almost nothing found.
 *
 * The continue route measured the read ceiling with the FIT multiplier (6) for
 * every mode, so a target of 8 was refused at 48 companies read while the
 * orchestrator allowed it 160. It also counted fit-only companies toward a
 * hybrid target that the orchestrator counts pairs only for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  continuationState,
  scansFor,
  likelyPairs,
  likelyFits,
  ABSOLUTE_SCAN_CEILING,
  passesNeeded,
  companiesPerPass,
} from "../lib/pipeline/scan-limits.js";

const base = {
  status: "complete",
  mode: "hybrid" as const,
  targetSignals: 8,
  companiesScanned: 50,
  qualified: 0,
  verify: 1,
  fitOnly: 9,
  poolExhausted: false,
};

test("the regression: a default target of 8 at 50 reads is NOT finished", () => {
  const s = continuationState(base);
  assert.equal(s.canContinue, true, "the run is allowed 160 reads; 50 is nowhere near the ceiling");
  assert.equal(s.ceiling, 160);
});

test("hybrid counts pairs only toward the target, like the orchestrator", () => {
  // Nine fit-only companies must NOT satisfy a target of 8 pairs.
  const s = continuationState({ ...base, qualified: 0, verify: 1, fitOnly: 9 });
  assert.equal(s.found, 1);
  assert.equal(s.reason, null);
});

test("filter mode counts every accepted company, and uses the fit multiplier", () => {
  const s = continuationState({ ...base, mode: "filter", targetSignals: 8, companiesScanned: 40 });
  assert.equal(s.ceiling, 48);
  assert.equal(s.found, 10);
  assert.equal(s.reason, "target-met");
});

test("stops, with the right reason, at each real limit", () => {
  assert.equal(continuationState({ ...base, status: "running" }).reason, "running");
  assert.equal(continuationState({ ...base, status: "failed" }).reason, "failed");
  assert.equal(continuationState({ ...base, qualified: 8 }).reason, "target-met");
  assert.equal(continuationState({ ...base, poolExhausted: true }).reason, "pool-dry");
  assert.equal(continuationState({ ...base, companiesScanned: 160 }).reason, "ceiling");
});

test("a target of 50 is reachable within the ceiling, not capped at 240", () => {
  assert.ok(ABSOLUTE_SCAN_CEILING >= 1000);
  assert.equal(scansFor(50, true), 1000);
  assert.ok(scansFor(50, true) > 240, "the old ceiling made 50 pairs arithmetically impossible");
});

test("nothing escapes the ceiling, whatever the target", () => {
  for (const t of [50, 100, 1000, 100000]) {
    assert.ok(scansFor(t, true) <= ABSOLUTE_SCAN_CEILING);
    assert.ok(scansFor(t, false) <= ABSOLUTE_SCAN_CEILING);
  }
});

test("what the form tells him to expect is the measured rate, not the optimistic one", () => {
  // 1,000 reads: about 33 pairs and about 167 fit-only. NOT 50 pairs.
  assert.equal(likelyPairs(1000), 33);
  assert.equal(likelyFits(1000), 167);
  assert.ok(likelyPairs(240) <= 8, "the old 240-read ceiling could deliver about 8 pairs, not 50");
});

test("a big search is several passes, and the estimate says so", () => {
  const ceilingMs = 300_000;
  assert.ok(passesNeeded(50, ceilingMs, true) > 1);
  assert.ok(companiesPerPass(ceilingMs) > 57, "eight in flight reads more than the old 57 per pass");
});
