/**
 * How much a run is allowed to read, and why the number depends on what it is
 * counting.
 *
 * This is the arithmetic behind "why did I get so few results". A live search
 * asked for 8 and returned 8 fit-only companies with ZERO founder-and-successor
 * pairs, then stopped, convinced it was finished. Two causes, both here:
 *
 *   - the ceiling was target x 6 for every mode. Six reads per ICP fit is
 *     about right; a confirmed pair needs about TWENTY. So "find 8 pairs"
 *     capped the run at 48 companies, inside which roughly 2 pairs exist —
 *     the request was arithmetically impossible to satisfy.
 *   - hybrid counted every accepted company toward the target, so eight plain
 *     fits ended the run before a pair was ever reached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scansFor,
  passesNeeded,
  expectedSignals,
  MAX_SCAN_MULTIPLIER,
  SIGNAL_SCAN_MULTIPLIER,
  ABSOLUTE_SCAN_CEILING,
} from "../lib/pipeline/scan-limits.js";

test("looking for pairs reads far more than looking for fits", () => {
  assert.ok(
    SIGNAL_SCAN_MULTIPLIER > MAX_SCAN_MULTIPLIER * 2,
    "a pair is much rarer than a fit; the multipliers must reflect that"
  );
  assert.ok(scansFor(8, true) > scansFor(8, false));
});

test("a target of N pairs can actually contain N pairs", () => {
  // The bug, stated as a property: whatever is asked for must be reachable
  // inside what the run is allowed to read.
  for (const target of [1, 3, 5, 8, 10]) {
    assert.ok(
      expectedSignals(target, true) >= target,
      `target ${target} allows only ~${expectedSignals(target, true)} pairs to exist`
    );
  }
});

test("the old ceiling could not have delivered — regression guard", () => {
  // 8 x 6 = 48 companies, about 2 pairs. Never let this come back.
  assert.ok(scansFor(8, true) >= 160, `signal runs must read enough: got ${scansFor(8, true)}`);
});

test("filter mode is unchanged — a fit really does arrive one in six", () => {
  assert.equal(scansFor(10, false), 60);
  assert.equal(scansFor(8, false), 48);
});

test("nothing escapes the absolute ceiling, whatever the target", () => {
  for (const t of [50, 100, 1000]) {
    assert.ok(scansFor(t, true) <= ABSOLUTE_SCAN_CEILING);
    assert.ok(scansFor(t, false) <= ABSOLUTE_SCAN_CEILING);
  }
});

test("passes are reported against the reading a run will really do", () => {
  const ceiling = 300_000; // the Hobby function limit
  // A signal run reads more, so it needs more passes than a filter run of the
  // same target — saying otherwise sends someone to a progress dialog that
  // stops long before they were told it would.
  assert.ok(passesNeeded(8, ceiling, true) > passesNeeded(8, ceiling, false));
  assert.ok(passesNeeded(1, ceiling, true) >= 1);
});
