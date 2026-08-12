/**
 * The client's ICP, as written — pinned so the code cannot drift back.
 *
 * This whole file exists because the system was built against an earlier,
 * narrower brief and the gap was invisible: every part of the pipeline agreed
 * with every other part, and all of them were agreeing about the wrong ICP.
 * Measured against rows already on disk, 42 companies had been read, paid for
 * and discarded for being a trade the client now asks for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { INDUSTRY_META } from "../lib/signal-meta.js";
import { AGREED_STATES } from "../lib/pipeline/us-states.js";
import { DEFAULT_ICP } from "../lib/pipeline/icp-types.js";
import { VALID_INDUSTRIES } from "../lib/pipeline/intake-types.js";
import { SUCCESSION_QUERY_SETS } from "../lib/pipeline/apify.js";
import { recheckAfterFor, isWrongKindOfBusiness } from "../lib/pipeline/recheck-policy.js";
import type { Industry } from "../lib/supabase/types.js";

// "Construction and contracting / luxury and custom homebuilding / landscaping
// and outdoor services / electrical, plumbing, HVAC, and specialty trades /
// manufacturing / distribution / home and property services / select
// professional-services firms with multiple family members involved."
const ICP_VERTICALS: Industry[] = [
  "landscaping", "home_builder", "construction", "trades",
  "manufacturing", "distribution", "property_services", "professional_services",
];

test("every vertical the ICP names is a real vertical", () => {
  for (const v of ICP_VERTICALS) {
    assert.ok(INDUSTRY_META[v], `${v} has no label`);
    assert.ok(VALID_INDUSTRIES.includes(v), `${v} is rejected by the intake parser`);
    assert.ok(SUCCESSION_QUERY_SETS[v]?.length, `${v} has no discovery queries`);
  }
});

test("a vertical with no queries can never be found — guard every one", () => {
  for (const v of ICP_VERTICALS) {
    for (const set of SUCCESSION_QUERY_SETS[v]) {
      assert.ok(set.length >= 3, `${v} has a set with only ${set.length} queries`);
      for (const q of set) assert.ok(q.trim().length > 10, `${v}: empty-ish query "${q}"`);
    }
  }
});

test("the trades the ICP now wants are no longer blacklisted as wrong-trade", () => {
  // Each of these used to earn an 18-month timeout. The ICP names all of them.
  for (const reason of [
    "This is an HVAC contractor.",
    "A plumbing contractor, not landscaping.",
    "A materials supplier — sells product, doesn't install.",
    "This is a metal fabrication manufacturer.",
  ]) {
    const at = recheckAfterFor("rejected", reason);
    assert.ok(at !== null, `"${reason}" was blacklisted permanently`);
    const days = Math.round((new Date(at).getTime() - Date.now()) / 86_400_000);
    assert.ok(days <= 120, `"${reason}" got ${days} days — an ICP vertical must come back soon`);
  }
});

test("verticals now in scope are not hidden from the cut list", () => {
  // Hiding a cut means the client never gets to disagree with it. Fine for a
  // funeral home; wrong for a vertical he asked for.
  for (const reason of [
    "This is a structural engineering firm with three family members.",
    "An architecture firm, family owned.",
    "A metal fabrication manufacturer.",
    "A building-materials distributor.",
  ]) {
    assert.equal(isWrongKindOfBusiness(reason), false, `"${reason}" would be hidden`);
  }
  // And the genuine noise still is hidden.
  for (const reason of [
    "This is a funeral home, not a landscaping company.",
    "A local newspaper's opinion site.",
    "A lead-gen marketplace connecting homeowners to contractors.",
  ]) {
    assert.equal(isWrongKindOfBusiness(reason), true, `"${reason}" leaked into the cut list`);
  }
});

test("the revenue band matches the written ICP", () => {
  assert.equal(DEFAULT_ICP.revenueMinMusd, 5, "ICP says $5 million floor");
  assert.equal(DEFAULT_ICP.revenueMaxMusd, 30, "ICP says $30 million ceiling");
});

test("'New York and the Northeast' actually searches the Northeast", () => {
  for (const s of ["CA", "NY", "FL", "TX"]) assert.ok(AGREED_STATES.includes(s), `${s} missing`);
  // The phrase covered nine states and the list held one.
  const northeast = ["NJ", "PA", "CT", "MA", "RI", "NH", "VT", "ME"];
  const present = northeast.filter((s) => AGREED_STATES.includes(s));
  assert.ok(present.length >= 6, `only ${present.length} Northeast states are searched`);
});
