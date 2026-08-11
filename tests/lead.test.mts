/**
 * The lead list as a LEAD LIST, in the delivered sample format: signal type,
 * signal detail, why this lead, when it surfaced, contact, score, source.
 *
 * The assertion that matters most is about overstating certainty. A 'verify'
 * company is one the pipeline flagged for a second look, and telling him a
 * succession signal "was confirmed" on one of those puts him on a call
 * asserting something about a family that may not be true.
 */
import { toLead, signalTypeOf, scoreFactors, SIGNAL_TYPE_META } from "../lib/lead-signal.js";
import type { Company, Evidence, Contact } from "../lib/company.js";
import type { Confidence } from "../lib/supabase/types.js";
import { explainFit } from "../lib/fit-explanation.js";

const base = {
  id: "1", domain: "acme.com", name: "Acme Landscaping", industry: "landscaping" as const,
  state: "CA", city: "San Diego", revenueBand: "$3-8M (est.)", employeeBand: "10-50",
  status: "qualified" as const, confidence: null as Confidence | null, rejectionReason: null,
  founderName: null as string | null, founderTitle: null as string | null,
  nextGenName: null as string | null, nextGenTitle: null as string | null,
  sourceUrl: "https://acme.com/about", hasSignal: false as boolean | null,
  discoveryChannel: "web_search", operatingModel: "own_crews",
  firstSeenAt: "2026-08-01T10:00:00Z", lastCrawledAt: "2026-08-09T10:00:00Z",
  evidence: null as Evidence | null, contact: null as Contact | null,
};
// Typed as Company rather than `any`: these fixtures are the only place the
// shape is asserted by hand, so a field renamed in the real type should break
// the test rather than silently pass.
const make = (o: Partial<Company>): Company => ({ ...base, ...o }) as Company;

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
  evidence: { quote: "joined by his son Sean", sourceUrl: "https://acme.com/about", pageType: "about", disproveNotes: undefined },
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

// ── the detail is never empty for a LEAD, and never filler for a cut ──────
ok("quote is used when there is one", (toLead(strong).signalDetail ?? "").includes("joined by his son"));
ok("falls back to the people when there is no quote",
   (toLead(make({ founderName: "Bill", nextGenName: "Beth" })).signalDetail ?? "").includes("Bill"));
ok("says so plainly when nobody is named",
   /No individual is named/.test(toLead(make({})).signalDetail ?? ""));

// A cut company said the reason once, in its own block. It used to appear
// three times: "Cut because: X", a filler line pointing at it, then X again.
{
  const cut = toLead(make({ status: "rejected", rejectionReason: "Not a landscaping company." }));
  ok("a cut company gets no filler quote", cut.signalDetail === null);
  ok("a cut company does not repeat its reason", cut.whyThisLead === "");
  const quoted = toLead(make({
    status: "rejected", rejectionReason: "Too big.",
    evidence: { quote: "Founded by Ray and now run by his daughter.", sourceUrl: "https://example.com/about", pageType: "about" },
  }));
  ok("a real quote survives a rejection", String(quoted.signalDetail ?? "").includes("Ray"));
}
ok("a LEAD always has a detail", (toLead(make({})).signalDetail ?? "").trim().length > 0);

// ── surfaced, not fabricated as an event date ─────────────────────────────
is("surfaced uses first seen", toLead(strong).surfacedAt, base.firstSeenAt);
ok("location falls back honestly",
   toLead(make({ city: "", state: "" })).location === "Location not stated");
ok("every signal type has a label", Object.values(SIGNAL_TYPE_META).every((m) => m.label && m.blurb));


// ═══════════════════════════════════════════════════════════════════════════
// PARKED CANDIDATES — an email read free off the page at classify time is a
// candidate, not a contact. It must not appear, score, or export until the
// lookup step has actually run.
// ═══════════════════════════════════════════════════════════════════════════
const { settledContact } = await import("../lib/company.js");
const { companiesToCsv } = await import("../lib/csv-export.js");

const parkedRow = make({
  contact: { name: null, nameInferred: false, title: null, email: "info@acme.com",
             findStatus: "not_attempted", verificationStatus: "not_attempted" },
});
const foundRow = make({
  contact: { name: "Sean", nameInferred: false, title: "VP", email: "sean@acme.com",
             findStatus: "found", verificationStatus: "valid" },
});

is("a parked candidate is not a contact", settledContact(parkedRow), null);
ok("a completed lookup is a contact", settledContact(foundRow)?.email === "sean@acme.com");
ok("a parked candidate does not raise the score",
   scoreFactors(parkedRow).score === scoreFactors(make({})).score,
   `${scoreFactors(parkedRow).score} vs ${scoreFactors(make({})).score}`);
ok("a real contact does raise the score", scoreFactors(foundRow).score > scoreFactors(make({})).score);
ok("no score reason mentions an email for a parked row",
   !scoreFactors(parkedRow).factors.some((f) => /email/i.test(f)));

const parkedCsv = companiesToCsv([parkedRow]).split("\r\n")[1];
ok("the CSV does not leak a parked email", !parkedCsv.includes("info@acme.com"), parkedCsv.slice(0, 80));
ok("the CSV says it is not enriched yet", parkedCsv.includes("not_enriched_yet"));
const foundCsv = companiesToCsv([foundRow]).split("\r\n")[1];
ok("the CSV does export a real contact", foundCsv.includes("sean@acme.com"));


// ═══════════════════════════════════════════════════════════════════════════
// SHARED INBOXES — kept, but never mistaken for the person.
// ═══════════════════════════════════════════════════════════════════════════
const { isSharedInbox } = await import("../lib/pipeline/page-email.js");

ok("info@ is a shared inbox", isSharedInbox("info@acme.com"));
ok("sales@ is a shared inbox", isSharedInbox("sales@acme.com"));
ok("office@ is a shared inbox", isSharedInbox("office@acme.com"));
ok("punctuation does not hide it", isSharedInbox("no-reply@acme.com"));
ok("will@ is a person", !isSharedInbox("will@acme.com"));
ok("marcus.kerske@ is a person", !isSharedInbox("marcus.kerske@acme.com"));
ok("missing email is not a shared inbox", !isSharedInbox(null));

const sharedVerified = make({ contact: { name: null, nameInferred: false, title: null,
  email: "info@acme.com", findStatus: "found", verificationStatus: "valid" } });
const personVerified = make({ contact: { name: "Will", nameInferred: false, title: null,
  email: "will@acme.com", findStatus: "found", verificationStatus: "valid" } });
ok("a verified shared inbox scores BELOW a verified person",
   scoreFactors(sharedVerified).score < scoreFactors(personVerified).score,
   `${scoreFactors(sharedVerified).score} vs ${scoreFactors(personVerified).score}`);
ok("a shared inbox still scores above nothing",
   scoreFactors(sharedVerified).score > scoreFactors(make({})).score);
ok("the reason says it is shared",
   scoreFactors(sharedVerified).factors.some((f) => /shared inbox/i.test(f)));
const sharedCsv = companiesToCsv([sharedVerified]).split("\r\n")[1];
ok("the CSV marks it shared_inbox", sharedCsv.includes("shared_inbox"));
ok("the CSV marks a person named_person",
   companiesToCsv([personVerified]).split("\r\n")[1].includes("named_person"));
ok("the CSV has a phone column", companiesToCsv([personVerified]).split("\r\n")[0].includes("phone"));
// The 1-10 score is a sort key now, never a rendered or exported figure: on
// real data 30 of 33 leads scored 4 or below, so printing it told the client
// his own leads were failures.
const hdr = companiesToCsv([personVerified]).split("\r\n")[0];
ok("the CSV does not export a score", !hdr.includes("score"));
ok("nor the score reasons", !hdr.includes("score_reasons"));
ok("but the ranking still orders leads",
   scoreFactors(personVerified).score > scoreFactors(make({})).score);

console.log(`${pass}/${pass + fails.length} lead-format assertions passed (incl. parked + shared)`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
