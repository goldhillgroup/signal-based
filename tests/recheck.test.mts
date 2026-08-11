/**
 * Asserts the recheck schedule against REAL rejection strings.
 *
 * The rules are ordered and first-match-wins, so splitting "wrong industry"
 * into permanent-vs-18-months is exactly the kind of change that silently
 * mis-routes a neighbouring case. Every string below was read off an actual
 * rejection_reason in the live database.
 *
 * The asymmetry that matters: scheduling a recheck too eagerly costs ~$0.018.
 * Marking something NEVER when it could change costs a lead, permanently and
 * invisibly. When in doubt these should schedule, not blacklist.
 */
import { recheckAfterFor, NEVER } from "../lib/pipeline/recheck-policy.js";

const NOW = new Date(2026, 7, 7);

function daysFor(reason: string): number | null {
  const iso = recheckAfterFor("rejected", reason, NOW);
  if (iso === NEVER) return null;
  return Math.round((new Date(iso!).getTime() - NOW.getTime()) / 86_400_000);
}

let pass = 0;
const fails: string[] = [];
function check(reason: string, want: number | null) {
  const got = daysFor(reason);
  if (got === want) pass++;
  else fails.push(`"${reason.slice(0, 56)}" -> wanted ${want ?? "NEVER"}, got ${got ?? "NEVER"}`);
}

// ── Genuinely permanent: not a trade business at all ──────────────────────
check("Cut — this is a lead-gen marketplace, not a contractor.", null);
check("Not an actual company — a directory platform listing contractors.", null);
check("This is a trade publication, not a single business.", null);
check("A real-estate brokerage, not a builder.", null);

// ── Wrong TRADE — must now schedule, not blacklist ────────────────────────
check("Outside the landscaping/home-builder ICP entirely — HVAC contractor.", 545);
check("Not a landscaping company — roofing only.", 545);
check("A materials supplier — sells product, doesn't install.", 545);

// ── The signal rule: THE one that changes, must stay at 90 ────────────────
check("Cut — only one generation is on the leadership page.", 90);
check("No next-gen family member is named anywhere.", 90);
check("Only the founder is named.", 90);

// ── Transient fetch problems retry fast ───────────────────────────────────
check("No About/Team/Leadership page could be fetched from this domain.", 14);
check("Classification failed: Could not parse JSON from model output", 14);
check("Page not found (404).", 14);

// ── The slower-moving facts ───────────────────────────────────────────────
check("No mention of any leadership team or family members — page names no individuals.", 120);
check("Too small — reads below the $3M lower bound set for this search.", 180);
check("Too big — reads above the $15M upper bound set for this search.", 365);
check("No longer family-owned — acquired/consolidated.", 365);

// ── A qualified company is never rescheduled ──────────────────────────────
if (recheckAfterFor("qualified", "anything", NOW) === null) pass++;
else fails.push("a QUALIFIED company must never be rescheduled");

// ── Unknown wording falls back to the signal cadence, not to NEVER ────────
check("Some phrasing nobody has seen before.", 90);

console.log(`\n${pass}/${pass + fails.length} schedule assertions passed`);
for (const f of fails) console.log("  ✗ " + f);
// Deliberately NOT process.exit here — the scope suite below is part of this
// file and an early exit would skip it silently while still reporting green.
let failed = fails.length > 0;

// ═══════════════════════════════════════════════════════════════════════════
// SCOPE — who a rejection is entitled to bind, which is a different question
// from when it expires. Verdicts made against one search's criteria were being
// applied to every future search; on live data that was 49% of all rejections.
// ═══════════════════════════════════════════════════════════════════════════
const { rejectionScope, sizeVerdictStillBinds, parseRevenueBand } = await import(
  "../lib/pipeline/recheck-policy.js"
);
const { bindsThisSearch } = await import("../lib/pipeline/orchestrator.js");

let p2 = 0;
const f2: string[] = [];
function is(label: string, got: unknown, want: unknown) {
  if (got === want) p2++;
  else f2.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

// --- scope classification, on real rejection strings ---
is("marketplace is global", rejectionScope("Not a real company — a lead-gen marketplace."), "global");
is("wrong trade is industry", rejectionScope("Outside the landscaping ICP — this is an HVAC contractor."), "industry");
is("supplier is industry", rejectionScope("Wrong industry — a materials supplier, not an installer."), "industry");
is("too small is size", rejectionScope("Too small — reads below the $3M lower bound set for this search."), "size");
is("too big is size", rejectionScope("Too big — reads above the $15M upper bound set for this search."), "size");
is("no successor is global", rejectionScope("Only the founder is named; no next-gen on the leadership page."), "global");
is("fetch failure is global", rejectionScope("Page could not be fetched (404)."), "global");
is("unknown wording defaults to global", rejectionScope("something nobody has written before"), "global");
is("null reason is global", rejectionScope(null), "global");

// --- revenue band parsing, on strings the classifier actually emits ---
is("under $1M lo", parseRevenueBand("under $1M (est.)")?.lo, 0);
is("under $1M hi", parseRevenueBand("under $1M (est.)")?.hi, 1);
is("$3-8M lo", parseRevenueBand("$3-8M (est.)")?.lo, 3);
is("$3-8M hi", parseRevenueBand("$3-8M (est.)")?.hi, 8);
is("$15M+ lo", parseRevenueBand("$15M+ (est.)")?.lo, 15);
is("$15M+ hi is open", parseRevenueBand("$15M+ (est.)")?.hi, Infinity);
is("unparseable is null", parseRevenueBand("some prose"), null);
is("absent is null", parseRevenueBand(null), null);

// --- does an old size verdict still bind? ---
is("$3-8M still too small for $10M+", sizeVerdictStillBinds("$3-8M (est.)", { min: 10, max: null }), true);
is("$3-8M is fine for $1M+", sizeVerdictStillBinds("$3-8M (est.)", { min: 1, max: null }), false);
is("$15M+ still too big under a $5M cap", sizeVerdictStillBinds("$15M+ (est.)", { min: null, max: 5 }), true);
is("$15M+ is fine with no cap", sizeVerdictStillBinds("$15M+ (est.)", { min: null, max: null }), false);
is("unbounded search binds nobody on size", sizeVerdictStillBinds("$3-8M (est.)", { min: null, max: null }), false);
is("unknown size never binds", sizeVerdictStillBinds(null, { min: 10, max: null }), false);
is("boundary: hi exactly equals min does not bind", sizeVerdictStillBinds("$3-10M (est.)", { min: 10, max: null }), false);

// --- the whole decision, end to end ---
const hvacCut = {
  status: "rejected",
  rejection_reason: "Outside the landscaping ICP — this is an HVAC contractor.",
  industry: "landscaping",
  revenue_band: "$3-8M (est.)",
};
is("HVAC cut still binds a landscaping search", bindsThisSearch(hvacCut, "landscaping" as never, { min: 1, max: 50 }), true);
is("HVAC cut does NOT bind an HVAC search", bindsThisSearch(hvacCut, "hvac" as never, { min: 1, max: 50 }), false);

const tooSmall = {
  status: "rejected",
  rejection_reason: "Too small — reads below the $10M lower bound set for this search.",
  industry: "landscaping",
  revenue_band: "$3-8M (est.)",
};
is("too-small still binds a $10M+ search", bindsThisSearch(tooSmall, "landscaping" as never, { min: 10, max: null }), true);
is("too-small does NOT bind a $1M+ search", bindsThisSearch(tooSmall, "landscaping" as never, { min: 1, max: null }), false);

const marketplace = {
  status: "rejected",
  rejection_reason: "Not a real company — a lead-gen marketplace.",
  industry: "landscaping",
  revenue_band: null,
};
is("a marketplace binds every search", bindsThisSearch(marketplace, "hvac" as never, { min: null, max: null }), true);

const won = { status: "qualified", rejection_reason: null, industry: "landscaping", revenue_band: "$3-8M (est.)" };
is("an accepted lead is never re-scanned", bindsThisSearch(won, "hvac" as never, { min: null, max: null }), true);

console.log(`${p2}/${p2 + f2.length} scope assertions passed`);
for (const f of f2) console.log("  ✗ " + f);
failed ||= f2.length > 0;
process.exit(failed ? 1 : 0);
