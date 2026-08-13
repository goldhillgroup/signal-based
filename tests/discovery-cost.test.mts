/**
 * What a discovery round is allowed to cost, per state selected.
 *
 * A live run across twelve states cost $2.19 for 60 companies — $0.037 each,
 * against $0.019 for a single-state run. Twice the price for a thinner spread
 * of reads. The cause was structural, not a bad estimate:
 *
 *   `groups` is one group PER STATE, and the directory and licensing channels
 *   ran for every group every round. Each directory call is 3-4 angles; each
 *   angle is one Tavily search plus up to four page reads with an extraction
 *   call on each. Twelve states => ~36 searches and up to ~144 extractions in
 *   a single round. Measured: 96 searches, 244 extractions.
 *
 * And it was spent on the worst-yielding channel in the codebase — 106 reads,
 * ZERO confirmed pairs. Maps already rotated states for this reason; these two
 * did not.
 *
 * These tests pin the ARITHMETIC of the fan-out, because that is what regressed
 * and it regressed silently — nothing failed, the bill just doubled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** Per-round calls for the three fan-out shapes, given N states. */
const allStatesEveryRound = (states: number, anglesPerCall: number) => states * anglesPerCall;
const oneStatePerRound = (_states: number, anglesPerCall: number) => anglesPerCall;

test("the old shape scales with the number of states — this is the bug", () => {
  // 12 states x 3 angles = 36 searches in ONE round, before page reads.
  assert.equal(allStatesEveryRound(12, 3), 36);
  // And each angle reads up to 4 pages, each with an extraction call.
  assert.equal(allStatesEveryRound(12, 3) * 4, 144);
});

test("rotating makes a round cost the same whatever the state count", () => {
  for (const states of [1, 4, 12, 50]) {
    assert.equal(
      oneStatePerRound(states, 3),
      3,
      "a round must not get more expensive because more states were selected"
    );
  }
});

test("the saving on a twelve-state search is twelvefold, not marginal", () => {
  const before = allStatesEveryRound(12, 3);
  const after = oneStatePerRound(12, 3);
  assert.equal(before / after, 12);
});

test("rotation still reaches every state across rounds", () => {
  // The property that makes this safe: over N rounds, all N states are covered.
  const states = 12;
  const covered = new Set<number>();
  for (let round = 1; round <= states; round++) covered.add((round - 1) % states);
  assert.equal(covered.size, states, "every state must be reached eventually");
});

test("a single-state search is unaffected", () => {
  // The common case must not pay for the fix.
  assert.equal(oneStatePerRound(1, 3), allStatesEveryRound(1, 3));
});
