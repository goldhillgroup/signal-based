import { test } from "node:test";
import assert from "node:assert/strict";
import { starsFor, STAR_LABEL, gradeSignal, nextStep } from "../lib/lead-score.js";
import type { Company } from "../lib/company.js";

/**
 * The score is Jonathan's qualification, said as a number. These pin the five
 * rungs and the two things it deliberately ignores.
 */

const base = {
  id: "1", searchId: "s", domain: "acme.com", name: "Acme", industry: "landscaping",
  state: "CT", city: "Bristol", revenueBand: null, employeeBand: null,
  status: "qualified", confidence: "high", rejectionReason: null,
  founderName: "Bill Acme", founderTitle: "Founder",
  nextGenName: "Ben Acme", nextGenTitle: "VP",
  sourceUrl: "https://acme.com/about", hasSignal: true, discoveryChannel: "web_search",
  operatingModel: null, firstSeenAt: "2026-01-01T00:00:00Z", lastCrawledAt: "2026-01-01T00:00:00Z",
  phone: "+1 860 555 0100", address: null,
  evidence: { quote: "my son Ben now runs it", sourceUrl: "https://acme.com/about", pageType: "about", disproveNotes: "checked" },
  contact: null, backupContact: null, allContacts: [],
} as unknown as Company;

const as = (patch: Record<string, unknown>) => ({ ...base, ...patch }) as unknown as Company;

test("a pair quoted in their own words is a 5", () => {
  assert.equal(starsFor(base), 5);
  assert.equal(gradeSignal(base).quality, "good");
});

test("a pair with nothing quoted is a 4", () => {
  assert.equal(starsFor(as({ evidence: null })), 4);
});

test("a pair whose wording is arguable is a 4", () => {
  assert.equal(starsFor(as({ confidence: "verify" })), 4);
});

test("a fit with somebody named is a 3", () => {
  assert.equal(starsFor(as({ hasSignal: false, evidence: null })), 3);
});

test("a fit with nobody named is a 2", () => {
  assert.equal(starsFor(as({ hasSignal: false, evidence: null, founderName: null, nextGenName: null })), 2);
});

test("a cut company is a 1", () => {
  assert.equal(starsFor(as({ status: "rejected" })), 1);
});

test("every rung has words a person can read", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    assert.ok(STAR_LABEL[n] && STAR_LABEL[n].length > 8, `rung ${n} has no label`);
  }
});

test("buying an address does not change the score", () => {
  // The mistake an earlier version made: folding enrichment into the score
  // meant a good company read as a bad lead because nobody had pressed a
  // button yet. That is what nextStep is for.
  const withEmail = as({
    contact: { name: "Ben Acme", nameInferred: false, title: "VP", email: "ben@acme.com",
               findStatus: "found", findSource: "anymailfinder", verificationStatus: "valid" },
    allContacts: [{ name: "Ben Acme", nameInferred: false, title: "VP", email: "ben@acme.com",
               findStatus: "found", findSource: "anymailfinder", verificationStatus: "valid" }],
  });
  assert.equal(starsFor(withEmail), starsFor(base));
  assert.equal(nextStep(withEmail), "ready to call");
  assert.equal(nextStep(base), "needs an email");
});

test("a fit never reads as needing an email it cannot use", () => {
  assert.equal(nextStep(as({ hasSignal: false })), "no signal yet");
});

test("a fit-only company is never called bad", () => {
  // 86% of the database. Calling that "not good" would be calling most of his
  // list bad, and it is an absence of evidence rather than a verdict.
  assert.equal(gradeSignal(as({ hasSignal: false })).quality, "no signal");
});
