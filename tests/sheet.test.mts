/**
 * Nothing reaches the client's sheet unless it is what it claims to be.
 *
 * These two columns are read as facts beside a real company name, and both were
 * carrying the model's hedging verbatim:
 *
 *   revenue_band    "$3-8M plausible but UN (est.)"   "Unconfirmed; single-so (est.)"
 *   founder_title   "Owner (implied — leads crew, gives quotes, referenced by…"
 *   next_gen_title  "No formal title on the company's own About"
 *
 * Each is the model saying "I do not know" formatted as data. An empty cell is
 * honest; a hedge dressed as a number is not.
 */
const { cleanRevenueBand, cleanTitle } = await import("../lib/lead-signal.js");

let pass = 0;
const fail: string[] = [];
const eq = (a: unknown, b: unknown, w: string) => {
  if (a === b) pass++; else fail.push(`${w}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// ── revenue: real figures survive ─────────────────────────────────────────
eq(cleanRevenueBand("$5-10M (est.)"), "$5-10M (est.)", "a plain range");
eq(cleanRevenueBand("$3-15M"), "$3-15M", "no suffix");
eq(cleanRevenueBand("$15M+ (est.)"), "$15M+ (est.)", "open-ended");
eq(cleanRevenueBand("under $1M (est.)"), "under $1M (est.)", "under");

// ── revenue: hedges do not ────────────────────────────────────────────────
eq(cleanRevenueBand("$3-8M plausible but UN (est.)"), null, "hedged range");
eq(cleanRevenueBand("Unconfirmed; single-so (est.)"), null, "prose");
eq(cleanRevenueBand("Genuinely unconfirmed (est.)"), null, "unconfirmed");
eq(cleanRevenueBand("unconfirmed (est.)"), null, "lowercase unconfirmed");
eq(cleanRevenueBand("Unknown"), null, "unknown");
eq(cleanRevenueBand(""), null, "empty");
eq(cleanRevenueBand(null), null, "null");
eq(cleanRevenueBand("a long sentence about why the revenue cannot be determined"), null, "sentence");

// ── titles: real ones survive ─────────────────────────────────────────────
eq(cleanTitle("Owner"), "Owner", "one word");
eq(cleanTitle("Vice President / COO"), "Vice President / COO", "slashes");
eq(cleanTitle("Founder / Landscape Designer"), "Founder / Landscape Designer", "two roles");

// ── titles: commentary is stripped, absences become null ──────────────────
eq(cleanTitle("Owner (implied — leads crew, gives quotes)"), "Owner", "hedging parenthetical dropped");
eq(cleanTitle("Owner (referred to as 'the boss' in testimonials)"), "Owner", "another hedge dropped");
eq(cleanTitle("No formal title on the company's own About"), null, "an absence");
eq(cleanTitle("Not individually titled on the company's own"), null, "another absence");

// ── THE ONES A BLUNTER VERSION BROKE ──────────────────────────────────────
// "(retired)" is not commentary. A retired founder is exactly what fails the
// "senior person must still be there" test, and hiding it behind a tidier
// title would bury the disqualifying fact.
eq(cleanTitle("Founders (retired)"), "Founders (retired)", "retired must survive");
eq(cleanTitle("Owner (Sr.)"), "Owner (Sr.)", "generation marker survives");
eq(cleanTitle("President (II)"), "President (II)", "suffix survives");
eq(cleanTitle("Owner (took over the company in 1992)"), "Owner (took over the company in 1992)", "a fact, not a hedge");
// A real title one word over an arbitrary cap must not be discarded.
eq(cleanTitle("VP & Head of Landscape / Project Manager"), "VP & Head of Landscape / Project Manager", "long but real");
eq(cleanTitle(""), null, "empty");
eq(cleanTitle(null), null, "null");

// ── and it never invents ──────────────────────────────────────────────────
{
  const out = cleanTitle("President");
  if (out !== null && !"President".includes(out)) fail.push("cleanTitle invented text");
  else pass++;
}

if (fail.length) { console.error(`${fail.length} FAILED:`); for (const f of fail) console.error("  " + f); process.exit(1); }
console.log(`${pass}/${pass} sheet-integrity assertions passed`);
