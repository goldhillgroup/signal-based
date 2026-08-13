/**
 * The written ICP criteria that were never wired up.
 *
 * Measured across 359 leads before this:
 *   revenue_band     known for 25%
 *   employee_band    known for  0%  <- the column existed the whole time
 *   years in business not captured at all
 *
 * Which meant the size judgement rested entirely on revenue — the criterion a
 * small company's website states LEAST often — while headcount, which pages
 * mention constantly ("our team of 24", "crew of 12"), was thrown away.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeCountFrom, isLifestyleBusiness } from "../lib/lead-signal.js";

test("reads headcount the way pages actually write it", () => {
  const cases: [string, number][] = [
    ["40 employees", 40],
    ["crew of 12", 12],
    ["over 100", 100],
    ["our team of 24", 24],
    ["3 crews", 3],
    ["we employ 60 people", 60],
  ];
  for (const [text, n] of cases) assert.equal(employeeCountFrom(text), n, `on "${text}"`);
});

test("a range takes the LOW end, never the flattering one", () => {
  // 25-30 must not read as 30 and slide a borderline company into the profile.
  assert.equal(employeeCountFrom("25-30"), 25);
  assert.equal(employeeCountFrom("15 to 20 staff"), 15);
});

test("nothing stated is null, not zero", () => {
  // Zero would read as "tiny" and reject; most pages simply do not say.
  assert.equal(employeeCountFrom(null), null);
  assert.equal(employeeCountFrom(""), null);
  assert.equal(employeeCountFrom("a growing team"), null);
});

test("a one or two person operation is outside the profile in ANY vertical", () => {
  // His words: "not lifestyle businesses or solo professional practices".
  assert.equal(isLifestyleBusiness("2 employees", ""), true);
  assert.equal(isLifestyleBusiness("just me", ""), true);
  assert.equal(isLifestyleBusiness(null, "We're a one-man operation serving Dallas"), true);
  assert.equal(isLifestyleBusiness(null, "As a sole proprietor I handle every job myself"), true);
});

test("SILENCE IS NOT SMALLNESS — the failure mode that would empty the product", () => {
  // Most pages say nothing about headcount. Treating that as tiny would reject
  // nearly everything, which is the same mistake as "no ownership info means
  // family-owned" but in the opposite direction.
  assert.equal(isLifestyleBusiness(null, "We provide landscaping across Westchester County."), false);
  assert.equal(isLifestyleBusiness(null, ""), false);
});

test("the ICP's soft floor is not a hard one", () => {
  // "Generally 25-150" is guidance. A real 15-person firm with crews and
  // managers is kept and shown, not cut for being under the typical range.
  assert.equal(isLifestyleBusiness("15 employees", ""), false);
  assert.equal(isLifestyleBusiness("crew of 8", ""), false);
  assert.equal(isLifestyleBusiness("3 crews", ""), false);
});

test("stated headcount beats prose in both directions", () => {
  // A page can boast "family owned, just like a one-man shop used to be" while
  // employing 40. The number wins.
  assert.equal(isLifestyleBusiness("40 employees", "we still feel like a one-man operation"), false);
});

// ── The criteria are HIS to set, not constants in a gate ──────────────────
//
// These arrived hardcoded, read off the document he sent. Wrong shape: his own
// wording is "GENERALLY 25-150 employees" and "USUALLY 15+ years", which
// describes his typical client rather than specifying a filter. A threshold
// buried in a gate is one he cannot see, cannot argue with, and has to ask a
// developer to move.
const { DEFAULT_ICP, normalizeIcp } = await import("../lib/pipeline/icp-types.js");

test("the defaults are what he actually wrote", () => {
  assert.equal(DEFAULT_ICP.employeeMin, 25);
  assert.equal(DEFAULT_ICP.employeeMax, 150);
  assert.equal(DEFAULT_ICP.minYearsInBusiness, 15);
  assert.equal(DEFAULT_ICP.excludeLifestyleBusinesses, true);
  assert.equal(DEFAULT_ICP.professionalServicesNeedFamily, true);
});

test("blank means the check is OFF, not zero", () => {
  // Zero would filter everything out; null switches the criterion off. This is
  // the whole point of making them settings.
  const icp = normalizeIcp({ employeeMin: "", employeeMax: null, minYearsInBusiness: "" });
  assert.equal(icp.employeeMin, null);
  assert.equal(icp.employeeMax, null);
  assert.equal(icp.minYearsInBusiness, null);
});

test("he can switch the exclusions off entirely", () => {
  const icp = normalizeIcp({
    excludeLifestyleBusinesses: false,
    professionalServicesNeedFamily: false,
  });
  assert.equal(icp.excludeLifestyleBusinesses, false);
  assert.equal(icp.professionalServicesNeedFamily, false);
});

test("a MISSING boolean keeps the default rather than switching it off", () => {
  // A form that predates the field must not silently disable an exclusion he
  // stated in writing. Absent is not the same as false.
  const icp = normalizeIcp({ signalFocus: "founder retiring" });
  assert.equal(icp.excludeLifestyleBusinesses, true);
  assert.equal(icp.professionalServicesNeedFamily, true);
});

test("a range entered backwards is corrected, not silently matched against nothing", () => {
  const icp = normalizeIcp({ employeeMin: 150, employeeMax: 25 });
  assert.equal(icp.employeeMin, 25);
  assert.equal(icp.employeeMax, 150);
});
