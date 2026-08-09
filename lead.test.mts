/**
 * The lead list as a LEAD LIST, in the delivered sample format: signal type,
 * signal detail, why this lead, when it surfaced, contact, score, source.
 *
 * The assertion that matters most is about overstating certainty. A 'verify'
 * company is one the pipeline flagged for a second look, and telling him a
 * succession signal "was confirmed" on one of those puts him on a call
 * asserting something about a family that may not be true.
 */
import { toLead, signalTypeOf, scoreFactors, SIGNAL_TYPE_META } from "./lib/lead-signal.js";
import { explainFit } from "./lib/fit-explanation.js";

const base = {
  id: "1", domain: "acme.com", name: "Acme Landscaping", industry: "landscaping" as const,
  state: "CA", city: "San Diego", revenueBand: "$3-8M (est.)", employeeBand: "10-50",
  status: "qualified" as const, confidence: null as any, rejectionReason: null,
  founderName: null as string | null, founderTitle: null as string | null,
  nextGenName: null as string | null, nextGenTitle: null as string | null,
  sourceUrl: "https://acme.com/about", hasSignal: false as boolean | null,
  discoveryChannel: "web_search", operatingModel: "own_crews",
  firstSeenAt: "2026-08-01T10:00:00Z", lastCrawledAt: "2026-08-09T10:00:00Z",
  evidence: null as any, contact: null as any,
};
const make = (o: Partial<typeof base>) => ({ ...base, ...o }) as any;

let pass = 0;
const fails: string[] = [];
function ok(label: string, cond: boolean, detail = "") {
  if (cond) pass++; else fails.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
function is(label: string, got: unknown, want: unknown) {
  if (got === want) pass++;
  else fails.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

// ── signal type ───────────────────────────────────────────────────────────
is("confirmed pair", signalTypeOf(make({ hasSignal: true, confidence: "high" })), "succession_pair");
is("medium is still a pair", signalTypeOf(make({ hasSignal: true, confidence: "medium" })), "succession_pair");
is("verify is its own type", signalTypeOf(make({ hasSignal: true, confidence: "verify" })), "succession_verify");
is("no signal is fit only", signalTypeOf(make({ hasSignal: false })), "family_owned_fit");

// ── NEVER claim confirmation on a verify lead ─────────────────────────────
const verifyLead = make({ hasSignal: true, confidence: "verify", founderName: "Paul", nextGenName: "Sean" });
const verifyText = explainFit(verifyLead)!.headline;
ok("a verify lead does not say 'confirmed'", !/was confirmed/.test(verifyText), verifyText);
ok("a verify lead tells him to check first", /check it before you call/.test(verifyText), verifyText);
const confirmedText = explainFit(make({ hasSignal: true, confidence: "high" }))!.headline;
ok("a high-confidence lead does say confirmed", /was confirmed/.test(confirmedText));
const fitText = explainFit(make({ hasSignal: false }))!.headline;
ok("a fit-only lead claims no signal", /No succession signal/.test(fitText));

// ── scores are ordered the way the leads are valuable ─────────────────────
const strong = make({ hasSignal: true, confidence: "high", nextGenName: "Sean",
  evidence: { quote: "joined by his son Sean", sourceUrl: "https://acme.com/about", pageType: "about", disproveNotes: null },
  contact: { name: "Sean", nameInferred: false, title: "VP", email: "sean@acme.com", findStatus: "found", verificationStatus: "valid" } });
const weak = make({ hasSignal: false });
ok("a confirmed, contactable pair outscores a bare fit", scoreFactors(strong).score > scoreFactors(weak).score);
ok("top score is capped at 10", scoreFactors(strong).score <= 10, String(scoreFactors(strong).score));
ok("lowest score is at least 1", scoreFactors(weak).score >= 1);
ok("verify scores below confirmed",
   scoreFactors(make({ hasSignal: true, confidence: "verify" })).score <
   scoreFactors(make({ hasSignal: true, confidence: "high" })).score);
ok("a verified email beats an unverified one",
   scoreFactors(make({ contact: { email: "a@b.com", verificationStatus: "valid", findStatus: "found", name: null, nameInferred: false, title: null } })).score >
   scoreFactors(make({ contact: { email: "a@b.com", verificationStatus: "risky", findStatus: "found", name: null, nameInferred: false, title: null } })).score);
ok("every score carries its reasons", scoreFactors(strong).factors.length >= 3);

// ── the detail is never empty, whatever is missing ────────────────────────
ok("quote is used when there is one", toLead(strong).signalDetail.includes("joined by his son"));
ok("falls back to the people when there is no quote",
   toLead(make({ founderName: "Bill", nextGenName: "Beth" })).signalDetail.includes("Bill"));
ok("says so plainly when nobody is named",
   /No individual is named/.test(toLead(make({})).signalDetail));
ok("detail is never blank", toLead(make({})).signalDetail.trim().length > 0);

// ── surfaced, not fabricated as an event date ─────────────────────────────
is("surfaced uses first seen", toLead(strong).surfacedAt, base.firstSeenAt);
ok("location falls back honestly",
   toLead(make({ city: "", state: "" })).location === "Location not stated");
ok("every signal type has a label", Object.values(SIGNAL_TYPE_META).every((m) => m.label && m.blurb));

console.log(`${pass}/${pass + fails.length} lead-format assertions passed`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
