import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreLead, scoreOf } from "../lib/lead-score.js";
import { DEFAULT_WEIGHTS, parseWeights } from "../lib/score-weights.js";
import type { Company } from "../lib/company.js";

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

const withEmail = (verification: string) => ({
  ...base,
  contact: { name: "Ben Acme", nameInferred: false, title: "VP", email: "ben@acme.com",
             findStatus: "found", findSource: "anymailfinder", verificationStatus: verification },
  allContacts: [{ name: "Ben Acme", nameInferred: false, title: "VP", email: "ben@acme.com",
             findStatus: "found", findSource: "anymailfinder", verificationStatus: verification }],
} as unknown as Company);

test("a complete pair with a deliverable address is ready to call", () => {
  const s = scoreLead(withEmail("valid"));
  assert.equal(s.band, "ready to call");
  assert.ok(s.score >= 90, `expected 90+, got ${s.score}`);
});

test("the same lead without an address scores lower and says why", () => {
  const s = scoreLead(base);
  assert.ok(s.score < scoreLead(withEmail("valid")).score);
  assert.ok(s.missing.includes("No email address at all"));
});

test("an unconfirmed address is worth less than a confirmed one", () => {
  assert.ok(scoreLead(withEmail("unknown")).score < scoreLead(withEmail("valid")).score);
});

test("a fit with no signal loses the largest single factor", () => {
  const noSignal = { ...base, hasSignal: false, evidence: null } as unknown as Company;
  const s = scoreLead(noSignal);
  assert.ok(s.missing.includes("No succession signal on the page"));
  assert.ok(s.score < 60, `expected under 60, got ${s.score}`);
  assert.equal(s.band, "no signal yet");
});

test("a band names the next action, never a verdict on the lead", () => {
  // Measured on 448 real leads, the median score is 15 and 85% would land in
  // whatever the bottom band is called. "thin" tells Jonathan most of what he
  // paid for is rubbish; "needs an email" tells him what to press.
  const pairNoEmail = scoreLead(base);
  assert.equal(pairNoEmail.band, "needs an email");
  for (const b of ["ready to call", "needs an email", "no signal yet"]) {
    assert.ok(!/thin|weak|poor|bad/i.test(b));
  }
});

test("a cut company has no score at all", () => {
  // It is not a lead, and a number would imply it had been ranked among them.
  assert.equal(scoreOf({ ...base, status: "rejected" } as unknown as Company), null);
});

test("every factor is a sentence about the company, not a code", () => {
  // The score is only useful because it shows its working; a factor labelled
  // "sig_conf_hi" would defeat the point.
  for (const f of scoreLead(withEmail("valid")).factors) {
    assert.ok(f.label.length > 12 && /[a-z] [a-z]/.test(f.label), `bad label: ${f.label}`);
  }
});

test("the score never leaves 0-100", () => {
  assert.ok(scoreLead(withEmail("valid")).score <= 100);
  const bare = { ...base, hasSignal: false, evidence: null, founderName: null,
                 nextGenName: null, phone: null, state: "-", city: "-" } as unknown as Company;
  assert.ok(scoreLead(bare).score >= 0);
});

test("every kept lead starts above zero", () => {
  // The harshness that had to be fixed: a real family-owned business in the
  // right trade and territory, read and judged and KEPT, scored 15 out of 100
  // because nobody had bought an address for it. Median across 448 leads was
  // 15 and 86% sat in the bottom band, which reads as "your list is rubbish"
  // when it means "your list is not enriched".
  const bare = { ...base, hasSignal: false, evidence: null, founderName: null,
                 nextGenName: null, phone: null, state: "-", city: "-" } as unknown as Company;
  assert.ok(scoreLead(bare).score >= 25, `a kept lead scored ${scoreLead(bare).score}`);
});

test("weights change the score", () => {
  const heavier = scoreLead(base, { ...DEFAULT_WEIGHTS, phone: 20 });
  assert.ok(heavier.score > scoreLead(base).score);
});

test("a zeroed weight removes its factor entirely", () => {
  const noPhone = scoreLead(base, { ...DEFAULT_WEIGHTS, phone: 0 });
  assert.equal(noPhone.factors.some((f) => /phone/i.test(f.label)), false);
});

test("nonsense weights fall back rather than zeroing every lead", () => {
  assert.deepEqual(parseWeights(null), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights({ phone: "lots" }), DEFAULT_WEIGHTS);
  assert.equal(parseWeights({ phone: 900 }).phone, DEFAULT_WEIGHTS.phone);
  assert.equal(parseWeights({ phone: 12 }).phone, 12);
});
