/**
 * The web-search actor call took 60 to 85 seconds against a limit of 90, and a call
 * that ran over came back as TIMED-OUT with none of its results: the best channel
 * lost for a whole round (found on the first production search, 2026-10-13).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WEB_SEARCH_TIMEOUT_SECS } from "../lib/pipeline/apify.js";
import { RUN_CEILING_MS } from "../lib/pipeline/reap.js";

test("the limit leaves real headroom over the 83 s a five-query call was measured at", () => {
  assert.ok(WEB_SEARCH_TIMEOUT_SECS >= 120, `${WEB_SEARCH_TIMEOUT_SECS}s is too close to the measured latency`);
});

test("a round started with the room the loop requires still finishes before the pass deadline", () => {
  // The loop starts a blocking round only if Date.now() + (limit + 5s) < deadline,
  // and the deadline is the run ceiling less a 45 s margin, so the round cannot run
  // past it, and certainly not past the platform's own limit.
  const worstCaseMs = WEB_SEARCH_TIMEOUT_SECS * 1000 + 5_000;
  assert.ok(worstCaseMs < RUN_CEILING_MS - 45_000, "a single round must be able to fit inside a pass");
});
