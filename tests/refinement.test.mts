/**
 * The Signal focus field must steer DISCOVERY, not only classification.
 *
 * It previously reached the classifier alone: a run with the focus "founder
 * retiring, son or daughter taking over" searched for generic landscapers and
 * judged them against the focus afterwards, which read 13 companies and
 * returned 0 signals. These tests pin the two properties that fix depends on —
 * the client's words become queries, and they are anchored to the trade.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refinementQueries, successionTermsFor, isOffTradeName } from "../lib/pipeline/apify.js";
import { callableName, earnedConfidence, relationshipStated } from "../lib/lead-signal.js";

test("no refinement leaves the proven rotation exactly as it was", () => {
  const base = successionTermsFor("landscaping", 1);
  assert.deepEqual(successionTermsFor("landscaping", 1, null), base);
  assert.deepEqual(successionTermsFor("landscaping", 1, ""), base);
  assert.equal(refinementQueries(null, "landscaping").length, 0);
  assert.equal(refinementQueries("   ", "landscaping").length, 0);
});

test("the client's words become quoted queries anchored to the trade", () => {
  const qs = refinementQueries("founder retiring, son or daughter taking over", "landscaping");
  assert.ok(qs.length > 0, "a stated focus must produce at least one query");
  for (const q of qs) {
    assert.match(q, /^"/, `each query leads with the quoted phrase: ${q}`);
    assert.match(q, /landscaping/, `each query is anchored to the trade: ${q}`);
  }
  // The phrase itself, not the whole sentence pasted into Google.
  assert.ok(qs.some((q) => /founder retiring/i.test(q)));
});

test("the focus is asked FIRST, so a tight budget spends it on what was asked for", () => {
  const qs = successionTermsFor("landscaping", 1, "founder retiring");
  const base = successionTermsFor("landscaping", 1);
  assert.ok(/founder retiring/i.test(qs[0]), "client's words lead the list");
  assert.equal(qs.length, base.length + 1, "focus adds, never replaces the proven set");
});

test("a runaway focus cannot multiply the SERP bill", () => {
  const wordy = Array.from({ length: 40 }, (_, i) => `phrase number ${i} here`).join(", ");
  assert.ok(refinementQueries(wordy, "landscaping").length <= 3, "capped at three");
});

test("fragments too short or too long to be a real phrase are dropped", () => {
  // Single words and connectives would match everything; a paragraph matches
  // nothing. Neither is worth a paid SERP page.
  assert.equal(refinementQueries("son", "landscaping").length, 0);
  assert.equal(refinementQueries("a, b, or c", "landscaping").length, 0);
  assert.equal(refinementQueries("x".repeat(200), "landscaping").length, 0);
});

test("with no vertical chosen the focus covers both trade families", () => {
  const qs = refinementQueries("second generation taking over", null);
  assert.ok(qs.some((q) => /landscaping/.test(q)));
  assert.ok(qs.some((q) => /home builder|custom homes/.test(q)));
});

test("off-trade names are recognised, and real company names never are", () => {
  for (const bad of [
    "Texas Association of Builders",
    "The National Law Review",
    "City of Jersey City",
    "Home & Design Magazine",
    "International Society of Arboriculture",
  ]) {
    assert.equal(isOffTradeName(bad), true, `should be filtered: ${bad}`);
  }
  // The trade never to make: these are real leads in the corpus. "Associates"
  // is not "Association"; a company can be named for a person or a place.
  for (const good of [
    "Oceanside Landscaping Inc",
    "Dennis Landscape Associates",
    "Semco Homes",
    "Scottie's Tree Service",
    "Holly Expert Tree Care Service, Inc.",
    "Country Lawn Care",
    "Sandlin Homes",
    // Place names that speculative patterns would have destroyed —
    // the reason the list is measured rather than brainstormed.
    "Council Bluffs Landscaping",
    "Institute Road Nursery",
    "Journal Square Tree Care",
  ]) {
    assert.equal(isOffTradeName(good), false, `must NOT be filtered: ${good}`);
  }
});

test("a succession claim needs two names Jonathan can actually look up", () => {
  // Both reached the sheet as confirmed pairs off pages with no surname —
  // "Eliseo"/"Brian" at HIGH confidence, from a customer review.
  assert.equal(callableName("Francisco Sr."), false);
  assert.equal(callableName("Eliseo"), false);
  assert.equal(callableName("Brian"), false);
  // A generational suffix is not a surname, but it doesn't disqualify one.
  assert.equal(callableName("Francisco Ruiz Sr."), true);
  assert.equal(callableName("Donnie Marchant"), true);
  assert.equal(callableName("Colt Ritzel III"), true);
  assert.equal(callableName("Mary-Jane O'Brien"), true);
  // Placeholders were already handled and must stay handled.
  for (const junk of ["", "  ", "-", "N/A", "unknown", "not stated", null, undefined]) {
    assert.equal(callableName(junk), false, `placeholder must fail: ${JSON.stringify(junk)}`);
  }
});

test("'high' must be earned: no receipt, or no stated relationship, means verify", () => {
  // The two real leads that carried HIGH without supporting it.
  assert.equal(
    earnedConfidence("high", null, "Bill and Beth Hewitt", "John Hewitt and Jesse Hewitt"),
    "verify",
    "no evidence quote at all"
  );
  assert.equal(
    earnedConfidence(
      "high",
      "As the current supervisor of all stages of the home construction process, Derek is involved in every detail",
      "Tommy Waters",
      "Derek Waters"
    ),
    "verify",
    "quote describes only the job; nothing states he is the owner's son"
  );
});

test("a stated relationship keeps the label it claimed", () => {
  // Each of these is a real quote from a real lead.
  const keep: [string, string, string][] = [
    ["Colt Ritzel joined his father, Ross, in 2021", "Ross Ritzel", "Colt Ritzel"],
    ["owned and operated by James Dinizo, son of founder Ralph Dinizo", "Ralph Dinizo", "James Dinizo"],
    ["Erin Jenkins Banas is the 3rd generation in Jenkins Landscape Company.", "Harold Jenkins", "Erin Jenkins Banas"],
    ["he works alongside his father in all aspects of the business", "Rich Cording, Sr.", "Rich Cording, Jr."],
    ["Led by Donnie and Debi Marchant, supported by their Son Seth", "Donnie Marchant", "Seth Marchant"],
  ];
  for (const [q, f, n] of keep) {
    assert.equal(earnedConfidence("high", q, f, n), "high", `should stay high: "${q.slice(0, 40)}…"`);
  }
});

test("Sr. paired with Jr. is itself a statement about generation", () => {
  // Elbers Landscape: the quote is two title lines with no relationship word,
  // but the names carry the claim.
  assert.equal(
    earnedConfidence(
      "medium",
      "James E. Hornung Sr., Owner. James E. Hornung Jr., Owner/President",
      "James E. Hornung Sr.",
      "James E. Hornung Jr."
    ),
    "medium"
  );
  // One suffix alone is not a pair.
  assert.equal(relationshipStated("two people work here", "James Hornung Sr.", "Peter Hornung"), false);
});

test("a shared surname alone never establishes a pair", () => {
  assert.equal(relationshipStated("Derek manages the sites", "Tommy Waters", "Derek Waters"), false);
  assert.equal(relationshipStated("Lee Greathouse Founding Advisor Will Greathouse Regional VP", "Lee Greathouse", "Will Greathouse"), false);
});

test("Jonathan's own hand-audited leads are exempt", () => {
  // They carry no quote because he verified them himself, not because the
  // evidence is missing. Demoting them tells him to re-check his own work.
  assert.equal(earnedConfidence("high", null, "A Person", "B Person", true), "high");
  assert.equal(earnedConfidence("high", null, "A Person", "B Person", false), "verify");
});

test("the gate only ever lowers, and never invents a label", () => {
  assert.equal(earnedConfidence(null, "son of the founder", "A Person", "B Person"), null);
  assert.equal(earnedConfidence("verify", null, "A Person", "B Person"), "verify");
});
