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
import { recheckAfterFor, NEVER } from "./lib/pipeline/recheck-policy.js";

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

console.log(`\n${pass}/${pass + fails.length} passed`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
