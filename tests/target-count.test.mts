/**
 * One definition of "found", shared by the pipeline and the progress dialog.
 *
 * They had a copy each, and the copies drifted the moment one changed. The
 * pipeline was corrected so hybrid counts founder-and-successor PAIRS — a run
 * had been filling its target with fit-only companies and stopping before it
 * found a single pair. The dialog kept adding fit-only rows in.
 *
 * A live run showed the cost. Read 60, 2 pairs, 13 fit-only, target 8:
 *
 *   pipeline:  2 of 8  -> keep going, four passes left
 *   dialog:   15 of 8  -> capped to "8 / 8", 100%, done
 *
 * The dialog announced a finished search a quarter of the way through. Worse,
 * the auto-continuation is gated on the DIALOG's number, so the four remaining
 * passes never ran. Nothing failed; the bar just filled up and went quiet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { countsTowardTarget, targetUnit } from "../lib/pipeline/target-count.js";

const RUN = { qualified: 2, verify: 0, fitOnly: 13 };

test("hybrid counts PAIRS — the bug, stated as a number", () => {
  // 2, not 15. This is the whole regression.
  assert.equal(countsTowardTarget("hybrid", RUN), 2);
});

test("signal mode counts pairs too", () => {
  assert.equal(countsTowardTarget("signal", RUN), 2);
});

test("filter mode counts every company that fits", () => {
  // It never claimed to look for a signal, so a plain fit is the deliverable.
  assert.equal(countsTowardTarget("filter", RUN), 15);
});

test("a hybrid run with 13 fits and no pair is NOT finished", () => {
  const target = 8;
  assert.ok(
    countsTowardTarget("hybrid", { qualified: 0, verify: 0, fitOnly: 13 }) < target,
    "13 fit-only companies must not satisfy a request for 8 pairs"
  );
});

test("verify-tier pairs count — they are still a pair, just thinner", () => {
  assert.equal(countsTowardTarget("hybrid", { qualified: 0, verify: 3, fitOnly: 0 }), 3);
});

test("the label names what is actually counted", () => {
  // "8 companies" beside a number that only moves on pairs told you the wrong
  // thing about why it was not moving.
  assert.equal(targetUnit("hybrid", 8), "pairs");
  assert.equal(targetUnit("signal", 1), "pair");
  assert.equal(targetUnit("filter", 8), "companies");
  assert.equal(targetUnit("filter", 1), "company");
});
