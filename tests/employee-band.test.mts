/**
 * The headcount the client asked for by name.
 *
 * His ICP lists "generally 25-150 employees" as a criterion in its own right,
 * and the field read 0% across 393 leads. It looked like the classifier
 * refusing to answer. It was not: the answer was being run through
 * cleanRevenueBand on the way to the database, and that function requires a
 * currency amount —
 *
 *   if (!/\$\s?\d/.test(t)) return null
 *
 * — so "40 employees", "crew of 12" and "25-30" were all nulled at the last
 * step. A field asked for, answered, and thrown away.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEmployeeBand, cleanRevenueBand, employeeCountFrom } from "../lib/lead-signal.js";

test("keeps the shapes a small business actually writes", () => {
  for (const s of ["40 employees", "crew of 12", "25-30", "over 100", "3 crews", "our team of 24"]) {
    assert.equal(cleanEmployeeBand(s), s, `should have kept "${s}"`);
  }
});

test("the old cleaner rejected every one of them — regression guard", () => {
  for (const s of ["40 employees", "crew of 12", "25-30", "over 100"]) {
    assert.equal(cleanRevenueBand(s), null, "cleanRevenueBand must stay currency-only");
    assert.notEqual(cleanEmployeeBand(s), null, "…and the headcount cleaner must not");
  }
});

test("refuses a revenue figure that wandered into the wrong field", () => {
  assert.equal(cleanEmployeeBand("$5-10M (est.)"), null);
  assert.equal(cleanEmployeeBand("$2M"), null);
});

test("refuses a hedge, a sentence, and a bare year", () => {
  assert.equal(cleanEmployeeBand("unknown"), null);
  assert.equal(cleanEmployeeBand("likely 20 or so"), null);
  assert.equal(cleanEmployeeBand("the page does not say how many people work there"), null);
  assert.equal(cleanEmployeeBand("1985"), null, "a founding year is not a headcount");
  assert.equal(cleanEmployeeBand("a family team"), null, "no number, no answer");
  assert.equal(cleanEmployeeBand(null), null);
});

test("and the count reads out of it, low end first", () => {
  // Low end so a borderline company is never flattered upward into the profile.
  assert.equal(employeeCountFrom("25-30"), 25);
  assert.equal(employeeCountFrom("crew of 12"), 12);
  assert.equal(employeeCountFrom("over 100"), 100);
  assert.equal(employeeCountFrom(null), null);
});

test("the ICP band is expressible from what is stored", () => {
  // "Generally 25-150 employees" — the whole point of keeping the field.
  const inBand = (s: string) => {
    const n = employeeCountFrom(cleanEmployeeBand(s));
    return n !== null && n >= 25 && n <= 150;
  };
  assert.equal(inBand("40 employees"), true);
  assert.equal(inBand("crew of 12"), false);
  assert.equal(inBand("over 100"), true);
  assert.equal(inBand("300 employees"), false);
});
