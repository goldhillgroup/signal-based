import { test } from "node:test";
import assert from "node:assert/strict";
import { folderTitle } from "../lib/folder-title.js";

test("a long state list becomes a count", () => {
  assert.equal(
    folderTitle(
      "family-owned companies in California, New York, New Jersey, Pennsylvania, Connecticut, Massachusetts, Rhode Island, New Hampshire, Vermont, Maine, Florida, Texas"
    ),
    "Family-owned companies · 12 states"
  );
  assert.equal(
    folderTitle("landscaping companies in California, New York, Florida, Texas"),
    "Landscaping companies · 4 states"
  );
});

test("one or two states are named, not counted", () => {
  // "· 2 states" is longer than the states and says less.
  assert.equal(folderTitle("landscaping in Connecticut"), "landscaping in Connecticut");
  assert.equal(
    folderTitle("home builders in Maine, Vermont"),
    "home builders in Maine, Vermont"
  );
});

test("labels that are not queries are left alone", () => {
  assert.equal(folderTitle("Hand-audited proof list"), "Hand-audited proof list");
  assert.equal(folderTitle("SINGLE KEY · landscaping · CT"), "SINGLE KEY · landscaping · CT");
});

test("the subject keeps its own 'in'", () => {
  // Splitting on the FIRST " in " would call "transition in California" a state.
  assert.equal(
    folderTitle("companies in transition in California, New York, Texas"),
    "Companies in transition · 3 states"
  );
});

test("never returns something longer than it was given", () => {
  for (const s of [
    "family-owned companies in California, New York, New Jersey, Texas",
    "Hand-audited proof list",
    "landscaping in CT",
    "",
  ]) {
    assert.ok(folderTitle(s).length <= s.trim().length || folderTitle(s) === s.trim());
  }
});
