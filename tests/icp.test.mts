/**
 * The ideal-client profile is the highest-leverage control in the product —
 * its signal focus becomes real search queries — so what it accepts and what
 * it refuses both matter. A malformed profile must degrade to "search the way
 * the product always did", never to a broken search button.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ICP, normalizeIcp } from "../lib/pipeline/icp-types.js";
import { refinementQueries } from "../lib/pipeline/apify.js";

test("the shipped default states the SIGNAL, not the category", () => {
  // "landscaping company" here would waste every generated query re-asking
  // what the industry filter already covers.
  assert.match(DEFAULT_ICP.signalFocus, /founder/i);
  assert.match(DEFAULT_ICP.signalFocus, /son or daughter|next gen|successor/i);
  assert.doesNotMatch(DEFAULT_ICP.signalFocus, /landscap|home build|construction/i);
});

test("the default focus actually produces usable discovery queries", () => {
  // The whole point of storing it. A default that generated nothing would be
  // a settings card that does nothing.
  const qs = refinementQueries(DEFAULT_ICP.signalFocus, ["landscaping"]);
  assert.ok(qs.length > 0, "the default must generate at least one query");
  for (const q of qs) assert.match(q, /landscaping/);
});

test("garbage degrades to a usable profile instead of throwing", () => {
  for (const junk of [null, undefined, 42, "nonsense", [], { signalFocus: 7 }]) {
    const icp = normalizeIcp(junk);
    assert.equal(typeof icp.signalFocus, "string");
    assert.ok(icp.revenueMinMusd === null || typeof icp.revenueMinMusd === "number");
    assert.ok(icp.revenueMaxMusd === null || typeof icp.revenueMaxMusd === "number");
  }
});

test("null means no limit and survives a round trip", () => {
  const icp = normalizeIcp({ signalFocus: "x y", revenueMinMusd: null, revenueMaxMusd: null });
  assert.equal(icp.revenueMinMusd, null);
  assert.equal(icp.revenueMaxMusd, null);
});

test("a band entered backwards is corrected, not stored as a band matching nothing", () => {
  const icp = normalizeIcp({ signalFocus: "", revenueMinMusd: 15, revenueMaxMusd: 3 });
  assert.equal(icp.revenueMinMusd, 3);
  assert.equal(icp.revenueMaxMusd, 15);
});

test("nonsense revenue becomes 'no limit' rather than a stored typo", () => {
  const icp = normalizeIcp({ signalFocus: "", revenueMinMusd: -5, revenueMaxMusd: 1e9 });
  assert.equal(icp.revenueMinMusd, null);
  assert.equal(icp.revenueMaxMusd, null);
});

test("a runaway focus is capped and trimmed", () => {
  const icp = normalizeIcp({ signalFocus: `  ${"a".repeat(5000)}  ` });
  assert.ok(icp.signalFocus.length <= 300);
  assert.equal(icp.signalFocus, icp.signalFocus.trim());
});

test("an empty focus is allowed — it means 'use the proven phrasings only'", () => {
  const icp = normalizeIcp({ signalFocus: "   " });
  assert.equal(icp.signalFocus, "");
  assert.equal(refinementQueries(icp.signalFocus, ["landscaping"]).length, 0);
});
