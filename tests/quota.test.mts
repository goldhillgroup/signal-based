/**
 * A harvest must be affordable for a whole month.
 *
 * The shipped default was two verticals at 20 companies, weekly. That reads
 * ~1,032 Firecrawl pages a month against a 1,025 allowance — over the limit
 * every single month, which would have shown up as the last harvest of each
 * month finding nothing, with no error anywhere.
 *
 * The fix was to cap the SIZE, not stretch the cadence. Weekly is what makes
 * the product feel alive; the overspend was never about how often it ran.
 */
const { monthlyPageUse, FIRECRAWL_PAGES_PER_MONTH, harvestEstimate } =
  await import("../lib/pipeline/schedule-types.js");
const { DEFAULT_SCHEDULE } = await import("../lib/pipeline/schedule.js");
const { HARVEST_CEILING_MS } = await import("../lib/pipeline/schedule-types.js");

let pass = 0;
const fail: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) pass++; else fail.push(`${n}${d ? " — " + d : ""}`); };

// ── the bug this exists to prevent ────────────────────────────────────────
{
  const over = monthlyPageUse(20, 2);
  ok("2 verticals x 20 weekly is OVER the page quota", !over.fits,
     `${Math.round(over.pages)} pages vs ${over.quota}`);
}

// ── the shipped default must be affordable ────────────────────────────────
{
  const d = monthlyPageUse(DEFAULT_SCHEDULE.targetPerRun, DEFAULT_SCHEDULE.industries.length);
  ok("the DEFAULT schedule fits the page quota", d.fits,
     `${Math.round(d.pages)} pages vs ${d.quota}`);
  ok("the default also leaves room for manual searches", d.pages < d.quota * 0.7,
     `uses ${Math.round((d.pages / d.quota) * 100)}% of the allowance`);
}

// ── every target the UI offers must be runnable ───────────────────────────
// Offering a number that cannot survive a month is offering a broken setting.
for (const t of [5, 10, 15]) {
  const u = monthlyPageUse(t, 2);
  ok(`target ${t} across 2 verticals fits`, u.fits, `${Math.round(u.pages)} pages`);
}

// ── and each one must finish inside the HARVEST's driver ──────────────────
// GitHub Actions, 90-minute job — not the 300s Vercel ceiling. Measuring
// against the wrong one told the user a runnable harvest would be cut off.
for (const t of [5, 10, 15]) {
  const e = harvestEstimate(t, 2, HARVEST_CEILING_MS);
  ok(`target ${t} finishes in one harvest job`, e.fits, `${e.minutes.toFixed(1)} min`);
}
ok("the harvest ceiling matches the workflow's job timeout", HARVEST_CEILING_MS === 90 * 60_000);

// ── the advice the UI gives must itself be correct ────────────────────────
{
  const u = monthlyPageUse(50, 2);
  ok("an over-quota setting reports a smaller workable target", u.maxTargetThatFits > 0);
  ok("and that suggestion actually fits", monthlyPageUse(u.maxTargetThatFits, 2).fits,
     `suggested ${u.maxTargetThatFits}`);
  ok("the suggestion is the LARGEST that fits",
     !monthlyPageUse(u.maxTargetThatFits + 1, 2).fits);
}

// ── one vertical buys headroom, and the maths must reflect that ───────────
{
  const one = monthlyPageUse(20, 1), two = monthlyPageUse(20, 2);
  ok("one vertical uses half of two", Math.abs(one.pages * 2 - two.pages) < 1);
  ok("20 across one vertical is affordable", one.fits, `${Math.round(one.pages)} pages`);
}

// ── the quota constant is the real one ────────────────────────────────────
ok("quota matches Firecrawl's actual monthly allowance", FIRECRAWL_PAGES_PER_MONTH === 1025);

if (fail.length) { console.error(`${fail.length} FAILED:`); for (const f of fail) console.error("  " + f); process.exit(1); }
console.log(`${pass}/${pass} quota assertions passed`);
