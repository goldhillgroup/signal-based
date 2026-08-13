/**
 * The second check: does a finished row contradict itself?
 *
 * A confirmed pair already gets a disprove pass — a separate model call asked
 * to refute it. Everything else got one look, and the fit-only tier is where
 * every bad lead of the last two days actually came from:
 *
 *   a Florida lead whose city was Raleigh-Durham
 *   an owner called "Erik A"
 *   a company called CURRENT_LIVE_SITE
 *
 * None needed a model to spot. Each is one field disagreeing with another —
 * which is what code is good at, and what a single pass is bad at, because the
 * classifier answers thirteen questions at once and never compares its own
 * answers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRow } from "../lib/pipeline/row-audit.js";
import type { ClassificationResult } from "../lib/pipeline/openrouter.js";

const base = {
  companyName: "Bland Landscaping",
  qualifies: true,
  industry: "landscaping",
  confidence: "verify",
  pageType: "about",
  founderName: null,
  founderTitle: null,
  nextGenName: null,
  nextGenTitle: null,
  quote: null,
  otherSignals: [],
  employeeBand: null,
  yearsInBusiness: null,
  city: null,
} as unknown as ClassificationResult;

const ctx = { state: "FL", pageText: "", domain: "blandlandscaping.com" };

test("the exact Florida/Raleigh-Durham row is caught", () => {
  const f = auditRow({ ...base, city: "Raleigh-Durham" }, ctx);
  const city = f.find((x) => x.field === "city");
  assert.ok(city, "a city in another state must be flagged");
  assert.equal(city!.drop, true);
  assert.match(city!.note, /NC/);
});

test("a city in the searched state is left alone", () => {
  assert.equal(auditRow({ ...base, city: "Orlando" }, ctx).length, 0);
});

test("an unrecognised town is not guessed at", () => {
  // Refusing contradictions is the job; validating every town in America is
  // not, and pretending otherwise would drop real small-town leads.
  assert.equal(auditRow({ ...base, city: "Windermere" }, ctx).length, 0);
});

test('"Erik A" is dropped, "Paula" is not', () => {
  const initial = auditRow({ ...base, founderName: "Erik A" }, ctx);
  assert.equal(initial.find((x) => x.field === "founderName")?.drop, true);

  // A first name is INCOMPLETE, not wrong. Next to a phone number "ask for
  // Paula" is how a small business is actually reached, and clearing it would
  // destroy real information to satisfy a rule aimed at something else.
  assert.equal(auditRow({ ...base, founderName: "Paula" }, ctx).length, 0);
  assert.equal(auditRow({ ...base, founderName: "Jason Troth" }, ctx).length, 0);
});

test("the founder and the successor cannot be the same person", () => {
  const f = auditRow({ ...base, founderName: "Ross Ritzel", nextGenName: "Ross Ritzel" }, ctx);
  assert.equal(f.find((x) => x.field === "nextGenName")?.drop, true);
});

test("a quote that never mentions the successor is flagged, not dropped", () => {
  // Flagged: the pairing may still be real and stated elsewhere on the page.
  // Dropping the quote would remove the receipt that lets somebody check it.
  const f = auditRow(
    { ...base, nextGenName: "Colt Ritzel", quote: "Our crews serve the whole county." },
    ctx
  );
  const q = f.find((x) => x.field === "quote");
  assert.ok(q);
  assert.equal(q!.drop, false);
});

test("a quote that does mention them passes", () => {
  const f = auditRow(
    { ...base, nextGenName: "Colt Ritzel", quote: "Colt Ritzel joined his father, Ross, in 2021" },
    ctx
  );
  assert.equal(f.find((x) => x.field === "quote"), undefined);
});

test("a clean row produces nothing at all", () => {
  const f = auditRow(
    {
      ...base,
      founderName: "Ralph Dinizo",
      nextGenName: "James Dinizo",
      quote: "owned and operated by James Dinizo, son of founder Ralph Dinizo",
      city: "Tampa",
    },
    ctx
  );
  assert.deepEqual(f, []);
});
