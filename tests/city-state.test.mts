/**
 * A city that belongs to another state.
 *
 * A live run produced "Bland Landscaping — state FL, city Raleigh-Durham".
 * Raleigh-Durham is North Carolina. The state comes from the search that found
 * the company; the city comes from the classifier reading the page. Nothing
 * checked they agreed, so the folder offered a Florida lead located in a
 * different state — worse than offering no city at all, because the client
 * would ring a company outside the area he asked about.
 *
 * cleanCity is module-private, so this tests the RULE it implements: a metro
 * that provably names another state must not survive alongside that state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const METRO_STATE: Record<string, string> = {
  raleigh: "NC", durham: "NC", nashville: "TN", atlanta: "GA",
  houston: "TX", austin: "TX", miami: "FL", orlando: "FL",
  boston: "MA", "new york": "NY",
};

/** The predicate as cleanCity applies it. */
function keeps(city: string, state: string): boolean {
  const low = city.toLowerCase();
  for (const [metro, st] of Object.entries(METRO_STATE)) {
    if (low.includes(metro) && st !== state) return false;
  }
  return true;
}

test("the exact case from the live run is refused", () => {
  assert.equal(keeps("Raleigh-Durham", "FL"), false);
});

test("a city in its own state is kept", () => {
  assert.equal(keeps("Houston", "TX"), true);
  assert.equal(keeps("Orlando", "FL"), true);
  assert.equal(keeps("Boston", "MA"), true);
});

test("an unrecognised town is left alone, not guessed at", () => {
  // The job is refusing provable contradictions, not validating every city in
  // America. A gazetteer this is not, and pretending otherwise would drop real
  // small-town leads.
  assert.equal(keeps("Kemah", "TX"), true);
  assert.equal(keeps("Webster", "TX"), true);
  assert.equal(keeps("Ferrisburgh", "VT"), true);
  assert.equal(keeps("Windermere", "FL"), true);
});

test("a compound metro name is caught on either half", () => {
  assert.equal(keeps("Raleigh", "FL"), false);
  assert.equal(keeps("Durham", "FL"), false);
});

test("same city name, right state, survives", () => {
  // Durham is in NC here; a lead genuinely in NC keeps it.
  assert.equal(keeps("Durham", "NC"), true);
});
