/**
 * Stopping BEFORE the platform kills the function, not when it already has.
 *
 * The run watches its own clock and stops 45 seconds early so it can write its
 * counts, cost and warning cleanly. That mechanism was right and incomplete:
 * the check can only fire BETWEEN operations, and a single operation can
 * outlast the whole remaining budget.
 *
 * Measured from the vendor code:
 *   Apify actor run       timeoutSecs = 120
 *   rendered page fetch   AbortSignal.timeout(90_000)
 *   Firecrawl scrape      AbortSignal.timeout(60_000)
 *
 * So a round beginning at t=180s passes the deadline check (255s), enters a
 * fetch, and returns at t=300s — after the platform has killed it. That is
 * exactly what happened live: killed at 60 companies, the row left saying
 * 'running' for ten minutes, 44 companies saved and nothing saying so.
 *
 * The question before each stage is therefore not "is there time left" but
 * "is there room for THIS".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RUN_CEILING_MS } from "../lib/pipeline/reap.js";

const MARGIN = 45_000;
const WORST = { discovery: 120_000, fetch: 90_000 };

/** The predicate as the orchestrator computes it. */
const hasRoomFor = (elapsed: number, ms: number) =>
  elapsed + ms < Math.max(30_000, RUN_CEILING_MS - MARGIN);

test("the old check passes right before an operation that overruns", () => {
  // t=250s. The deadline is 255s, so outOfTime() is false and the run happily
  // begins a fetch that cannot finish before the platform kills it at 300s.
  const elapsed = 250_000;
  const deadline = RUN_CEILING_MS - MARGIN;
  assert.ok(elapsed < deadline, "outOfTime() says there is time");
  assert.ok(
    elapsed + WORST.fetch > RUN_CEILING_MS,
    "yet the fetch alone runs past the platform's kill — this is the bug"
  );
});

test("room-aware checks refuse to start what cannot finish", () => {
  assert.equal(hasRoomFor(250_000, WORST.fetch), false);
  assert.equal(hasRoomFor(250_000, WORST.discovery), false);
});

test("and still allow work early in the run", () => {
  assert.equal(hasRoomFor(10_000, WORST.discovery), true);
  assert.equal(hasRoomFor(10_000, WORST.fetch), true);
});

test("nothing is started that could cross the platform ceiling", () => {
  // The property that matters: for every moment the run would begin a stage,
  // that stage's worst case still lands inside the real limit.
  for (let elapsed = 0; elapsed < RUN_CEILING_MS; elapsed += 5_000) {
    for (const ms of Object.values(WORST)) {
      if (hasRoomFor(elapsed, ms)) {
        assert.ok(
          elapsed + ms < RUN_CEILING_MS,
          `starting a ${ms}ms stage at ${elapsed}ms would overrun ${RUN_CEILING_MS}ms`
        );
      }
    }
  }
});

test("fetch gets a window discovery does not", () => {
  // Late in a run it should stop BUYING candidates but still drain the buffer
  // it already paid for — cheaper work deserves a longer window.
  // Discovery is blocked from t=135s (135+120 >= 255); fetch survives to
  // t=165s (165+90 >= 255). So there is a real window where the run stops
  // buying and keeps reading.
  const late = 140_000;
  assert.equal(hasRoomFor(late, WORST.discovery), false, "stop buying");
  assert.equal(hasRoomFor(late, WORST.fetch), true, "keep reading what is bought");
});
