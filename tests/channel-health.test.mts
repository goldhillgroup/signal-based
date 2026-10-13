/**
 * "Searched with 3 of 4 discovery channels, A discovery channel failed. Results
 * may be incomplete until that's topped up." -- shown on real runs, naming no
 * channel, advising a top-up for something that was never broken.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWarningLine } from "../lib/pipeline/channel-health.js";

test("a partial failure is parsed, never reported as 'A discovery channel'", () => {
  const w = buildWarningLine(["Web search channel failed for NY/NJ only"]);
  assert.ok(w, "a material channel degraded, so there is a warning");
  assert.ok(w!.includes("Web search"), w!);
  assert.ok(!/A discovery channel/.test(w!), w!);
  assert.ok(/NY/.test(w!) && /NJ/.test(w!), "says WHICH states could not be searched");
});

test("only minor channels degraded: no banner at all", () => {
  // Directories and licensing boards produced no confirmed pairs in 159 reads;
  // a free government download timing out says nothing about the results.
  assert.equal(buildWarningLine(["Licensing channel failed: CSLB export C-27: HTTP 504"]), null);
  assert.equal(buildWarningLine(["Directory channel failed: timeout"]), null);
  assert.equal(
    buildWarningLine([
      "Licensing channel failed: HTTP 504",
      "Directory channel failed: timed out",
    ]),
    null
  );
});

test("a material channel failing outright is reported, by name and reason", () => {
  const w = buildWarningLine([
    "Web search channel failed: Apify self-imposed budget cap hit: this account has used $29.1 this cycle (cap: $29)",
  ]);
  assert.ok(w);
  assert.ok(/Web search hit its spending cap/.test(w!), w!);
  assert.ok(/topped up/.test(w!), "an actionable failure says so");
});

test("Maps is called by the name a person would use", () => {
  const w = buildWarningLine(["Maps channel failed: timed out after 120s"]);
  assert.ok(w && /Google Maps timed out/.test(w), w ?? "null");
});

test("one failure in four calls is not a degraded run", () => {
  assert.equal(buildWarningLine(["Maps channel failed: timeout"], 4, { calls: 4 }), null);
});

test("a channel failing in at least half the calls is", () => {
  const w = buildWarningLine(
    ["Maps channel failed: timeout", "Maps channel failed: timeout"],
    4,
    { calls: 4 }
  );
  assert.ok(w && /Google Maps/.test(w));
});

test("without a call count every failure counts, as before", () => {
  assert.ok(buildWarningLine(["Maps channel failed: timeout"]));
});

test("nothing able to search says so plainly", () => {
  const w = buildWarningLine([
    "Directory channel failed: x",
    "Licensing channel failed: x",
    "Web search channel failed: x",
    "Maps channel failed: x",
  ]);
  assert.ok(w && /No channel was able to search/.test(w), w ?? "null");
});

test("a healthy run says nothing", () => {
  assert.equal(buildWarningLine([]), null);
});

test("Apify's own wording for a run that passed its limit is read as a timeout, not an unknown failure", () => {
  // From a real run, 2026-10-13. The hyphen in TIMED-OUT is why this used to
  // print the vague "Web search failed".
  const w = buildWarningLine([
    'Web search channel failed: Apify actor apify~google-search-scraper failed: 400 {"error":{"type":"run-failed","message":"Actor run did not succeed (run ID: isELC19EpzEWfUBkX, status: TIMED-OUT)."}}',
  ]);
  assert.ok(w && /Web search timed out/.test(w), w ?? "null");
});
