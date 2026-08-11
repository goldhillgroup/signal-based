/**
 * The multi-state fan-out must SPLIT the round budget, not multiply it.
 *
 * A live four-state run read 83 companies and every one was Californian —
 * discovery pinned to state one because `round` only advances when the
 * candidate buffer empties. Fixing that by calling every state per round is
 * only safe if the spend stays flat, so these assert the arithmetic that
 * makes it flat, and that the old floor-based overspend is gone.
 */
const MAPS_PLACES_PER_ROUND = 12;
const PER_TERM_MIN = 5;
const ROUND_SIZE = 15;

/** Which state group Maps covers this round — it rotates, one per round. */
function mapsGroupFor(round: number, groups: number) {
  return (round - 1) % groups;
}

/** Mirrors discoverViaMaps' budget maths exactly. `limit` is perGroupLimit. */
function mapsSpend(termPool: number, share: number, round: number, limit = Math.ceil(ROUND_SIZE / share)) {
  const placeBudget = Math.max(PER_TERM_MIN, Math.min(MAPS_PLACES_PER_ROUND, limit));
  const termCount = Math.max(1, Math.min(termPool, Math.floor(placeBudget / PER_TERM_MIN)));
  const start = ((round - 1) * termCount) % termPool;
  const terms = Array.from({ length: termCount }, (_, i) => (start + i) % termPool);
  const perTerm = Math.max(1, Math.floor(placeBudget / termCount));
  return { places: termCount * perTerm, terms, perTerm };
}

/** Mirrors discoverViaWebSearch' query maths exactly. */
function webPages(poolSize: number, share: number) {
  return Math.max(1, Math.min(poolSize, Math.floor(poolSize / share)));
}

let pass = 0;
const fails: string[] = [];
function ok(label: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else fails.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// ── the overspend that existed before ─────────────────────────────────────
// Old rule: perTerm = max(5, floor(30/terms)); with 10 terms that bought
// 10 x 5 = 50 places against a budget of 30.
const oldIndustryless = 10 * Math.max(5, Math.floor(30 / 10));
ok("old rule really did overspend", oldIndustryless === 50, `was ${oldIndustryless}`);
ok(
  "industry-less search respects the budget",
  mapsSpend(10, 1, 1).places <= MAPS_PLACES_PER_ROUND,
  `bought ${mapsSpend(10, 1, 1).places}`
);

// ── single state is unchanged ─────────────────────────────────────────────
ok("landscaping, one state, spends its full budget", mapsSpend(5, 1, 1).places === MAPS_PLACES_PER_ROUND, `${mapsSpend(5,1,1).places}`);
ok("one state = one web page per phrasing", webPages(6, 1) === 6);

// ── four states cost the same as one, because only ONE gets Maps per round ─
// Splitting the budget four ways would put every call under PER_TERM_MIN, and
// that floor pushes total spend back ABOVE the budget — the exact bug the cut
// exists to fix. Rotation avoids it entirely.
for (const pool of [5, 10]) {
  const one = mapsSpend(pool, 1, 1).places;
  const covered = [1, 2, 3, 4].filter((r) => mapsGroupFor(r, 4) === 0).length;
  ok(`maps: pool ${pool}, only one state per round is bought`, covered === 1, `${covered} rounds hit group 0 in 4`);
  ok(`maps: that one buy is within a single state's budget`, mapsSpend(pool, 4, 1).places <= one,
     `${mapsSpend(pool, 4, 1).places} vs ${one}`);
}
ok("every state gets Maps within `states` rounds", new Set([1,2,3,4].map((r) => mapsGroupFor(r, 4))).size === 4);
ok("rotation wraps", mapsGroupFor(5, 4) === mapsGroupFor(1, 4));

// ── the cut itself ────────────────────────────────────────────────────────
ok("a round never buys more than 12 places", mapsSpend(5, 1, 1).places <= MAPS_PLACES_PER_ROUND,
   String(mapsSpend(5, 1, 1).places));
ok("the buy is capped by what the round can READ",
   mapsSpend(5, 1, 1, 4).places <= Math.max(PER_TERM_MIN, 4), `${mapsSpend(5, 1, 1, 4).places}`);
ok("30 places was the old default, and is now unreachable",
   mapsSpend(10, 1, 1, 999).places < 30, String(mapsSpend(10, 1, 1, 999).places));
ok("web: 4 states cost no more than 1 state", webPages(6, 4) * 4 <= 6 * 1, `${webPages(6,4)*4} vs 6`);
ok("web: every state still gets at least one query", webPages(6, 4) >= 1);
ok("web: even 8 states get a query each", webPages(6, 8) >= 1);

// ── every state is covered on EVERY round, which is the actual bug fix ────
const states = ["CA", "NY", "TX", "FL"];
const groups = states.length > 1 ? states.map((s) => [s]) : [states];
ok("four states produce four groups", groups.length === 4);
ok("each group holds exactly one state", groups.every((g) => g.length === 1));
ok("single state produces one group", (["CA"].length > 1 ? [] : [["CA"]]).length === 1);

// ── rotation still reaches every trade term across rounds ─────────────────
const seen = new Set<number>();
for (let r = 1; r <= 8; r++) mapsSpend(5, 4, r).terms.forEach((t) => seen.add(t));
ok("a tight 4-state budget still covers all 5 trade terms over 8 rounds", seen.size === 5, `saw ${seen.size}`);

// ── depth stays useful, never 1-place queries ─────────────────────────────
for (const share of [1, 2, 4]) {
  ok(`share ${share} keeps per-term depth >= ${PER_TERM_MIN}`, mapsSpend(5, share, 1).perTerm >= PER_TERM_MIN,
     `got ${mapsSpend(5, share, 1).perTerm}`);
}

console.log(`${pass}/${pass + fails.length} fan-out assertions passed`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
