/**
 * The revenue band gate, which was the biggest and least defensible cut in
 * the funnel: 21 of 77 rejections, eleven of them with no revenue figure
 * recorded at all.
 *
 * The rule these assert: cut ONLY when there is a real estimated range and
 * that range cannot overlap the requested band. Unknown size never cuts.
 */
import { parseRevenueBand } from "./lib/pipeline/recheck-policy.js";

// Mirrors the gate in orchestrator.ts. Kept in step by asserting the same
// inputs that produced the live rejections.
function gate(revenueEstimate: string | null, band: { min: number | null; max: number | null } | undefined) {
  const bandSet = !!band && (band.min !== null || band.max !== null);
  const est = parseRevenueBand(revenueEstimate);
  const below = bandSet && band!.min !== null && est !== null && est.hi < band!.min;
  const above = bandSet && band!.max !== null && est !== null && est.lo > band!.max;
  return below ? "cut_small" : above ? "cut_big" : "keep";
}

let pass = 0;
const fails: string[] = [];
function is(label: string, got: string, want: string) {
  if (got === want) pass++;
  else fails.push(`${label}: expected ${want}, got ${got}`);
}

const B = { min: 3, max: 15 }; // the band that produced the live rejections

// ── the eleven with no figure at all — the whole point of this change ─────
is("no estimate never cuts", gate(null, B), "keep");
is("unparseable estimate never cuts", gate("mid-size, established", B), "keep");
is("'unknown' never cuts", gate("unknown", B), "keep");

// ── the boundary cases that were being thrown away ────────────────────────
is("$1-3M against a $3M floor overlaps at 3", gate("$1-3M (est.)", B), "keep");
is("under $3M against a $3M floor still touches", gate("under $3M (est.)", B), "keep");
is("$15M+ against a $15M ceiling overlaps at 15", gate("$15M+ (est.)", B), "keep");

// ── genuine misses still get cut ──────────────────────────────────────────
is("under $1M is really below a $3M floor", gate("under $1M (est.)", B), "cut_small");
is("$40M+ is really above a $15M ceiling", gate("$40M+ (est.)", { min: 3, max: 15 }), "cut_big");
is("$20-30M is above the ceiling", gate("$20-30M (est.)", B), "cut_big");

// ── an unbounded search cuts nobody on size ───────────────────────────────
is("no band set, tiny company kept", gate("under $1M (est.)", { min: null, max: null }), "keep");
is("no band set, huge company kept", gate("$500M+ (est.)", { min: null, max: null }), "keep");
is("no band object at all", gate("under $1M (est.)", undefined), "keep");

// ── one-sided bands only cut on their own side ────────────────────────────
is("floor only, small company cut", gate("under $1M (est.)", { min: 3, max: null }), "cut_small");
is("floor only, huge company kept", gate("$500M+ (est.)", { min: 3, max: null }), "keep");
is("ceiling only, huge company cut", gate("$500M+ (est.)", { min: null, max: 15 }), "cut_big");
is("ceiling only, tiny company kept", gate("under $1M (est.)", { min: null, max: 15 }), "keep");

// ── the two real companies this change exists for ─────────────────────────
is("Two Generations Landscaping (no figure) is kept", gate(null, B), "keep");
is("Third Generation Lawn & Landscape (no figure) is kept", gate(null, B), "keep");

console.log(`${pass}/${pass + fails.length} band assertions passed`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
