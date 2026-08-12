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
import { BAND_OPTIONS, bandIndexFor, ICP_SIGNALS, ICP_SIGNAL_GROUPS } from "../lib/search-options.js";
import { DEFAULT_SCHEDULE } from "../lib/pipeline/schedule.js";
import { monthlyPageUse } from "../lib/pipeline/schedule-types.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

test("the form's revenue chips offer the ICP's bands, not the old brief's", () => {
  // The chips are what a person actually clicks. The default and the
  // classifier both moved to $5-30M while these still read "$3-15M
  // (baseline)", so the form kept offering the profile the system no longer
  // used.
  const labels = BAND_OPTIONS.map((b) => b.label).join(" ");
  assert.doesNotMatch(labels, /\$3-15M/, "the old brief's band is still offered");
  assert.ok(
    BAND_OPTIONS.some((b) => b.min === 5 && b.max === 15),
    "the ICP's sweet spot ($5-15M) must be one click"
  );
  assert.ok(
    BAND_OPTIONS.some((b) => b.min === 5 && b.max === 30),
    "the ICP's full band ($5-30M) must be one click"
  );
});

test("the scheduled harvest aims at the ICP too", () => {
  // A job nobody watches must not be running the old profile.
  assert.equal(DEFAULT_SCHEDULE.revenueMinMusd, 5);
  assert.equal(DEFAULT_SCHEDULE.revenueMaxMusd, 15, "sweet spot, not the full band");
  // And it must stay inside the Firecrawl quota — widening it silently
  // multiplies a bill nobody is watching.
  const use = monthlyPageUse(DEFAULT_SCHEDULE.targetPerRun, DEFAULT_SCHEDULE.industries.length);
  assert.ok(use.fits, `${Math.round(use.pages)} pages vs ${use.quota}`);
});

test("no module keeps its own private list of verticals", () => {
  // A local `const VALID_INDUSTRIES = ["landscaping", "home_builder"]` in
  // app/api/search/route.ts SHADOWED the shared one and froze at the original
  // two, so the form offered eight verticals and the HTTP route refused six.
  // The end-to-end tests missed it completely because they call
  // runSearchPipeline directly and never cross that route.
  //
  // Guards the shape of the bug, not the one instance: any file redeclaring
  // the list is a copy that can drift.
  const roots = ["app", "lib", "components"];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const src = readFileSync(full, "utf8");
        if (
          /const\s+VALID_INDUSTRIES\s*[:=]/.test(src) &&
          !full.endsWith("intake-types.ts")
        ) {
          offenders.push(full);
        }
      }
    }
  };
  for (const r of roots) walk(r);
  assert.deepEqual(offenders, [], `these redeclare the vertical list: ${offenders.join(", ")}`);
});

test("an unrecognised saved band never becomes 'No limit'", () => {
  // The fallback was the LAST option, which is "No limit" — so a band the
  // chips no longer offer did not merely display oddly, the form initialised
  // to unbounded and SEARCHED with it. It happened: the ICP stored in the
  // database still held the old $3-15M, nothing matched, and a bounded search
  // silently became the widest and most expensive one available.
  const unknown = bandIndexFor(3, 15);
  assert.notEqual(
    BAND_OPTIONS[unknown].label,
    "No limit",
    "an unmatched band must not default to unbounded"
  );
  // If it has to guess, it guesses narrow: too tight shows fewer companies and
  // is obvious; too loose spends more and looks like it worked.
  assert.equal(BAND_OPTIONS[unknown].min, 5);
  assert.equal(BAND_OPTIONS[unknown].max, 15);
  // A band that IS offered still resolves to itself.
  assert.equal(BAND_OPTIONS[bandIndexFor(5, 30)].label, "$5-30M (full ICP)");
  assert.equal(BAND_OPTIONS[bandIndexFor(null, null)].label, "No limit");
});

test("every observable signal in the ICP is something he can click", () => {
  // His profile lists twelve under "Observable lead-generation signals". They
  // were reachable only by typing the right phrase into a free-text box, which
  // meant knowing they existed.
  assert.equal(ICP_SIGNALS.length, 12, "the ICP names twelve signals");
  // Three per group, so the grid stays even at every width rather than
  // wrapping into a ragged block.
  for (const g of ICP_SIGNAL_GROUPS) {
    assert.equal(g.signals.length, 3, `"${g.heading}" has ${g.signals.length}, breaking the grid`);
  }
  // The phrase is what reaches discovery and the classifier, so it has to read
  // as words a company would use about itself — not as a category name.
  for (const s of ICP_SIGNALS) {
    assert.ok(s.phrase.split(/\s+/).length >= 3, `"${s.phrase}" is too thin to search with`);
    assert.doesNotMatch(s.phrase, /_/, `"${s.phrase}" looks like an identifier, not a search`);
    // Labels sit in a grid; a long one makes its whole row taller.
    assert.ok(s.label.length <= 26, `"${s.label}" will wrap and unbalance the row`);
  }
});
