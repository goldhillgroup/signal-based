/**
 * The run stops ITSELF before the platform kills it.
 *
 * Every completion path in the orchestrator lives after the round loop, so a
 * process terminated mid-loop leaves status='running' forever: the progress
 * dialog polls a dead row and Enrich refuses the folder. The reaper cleans that
 * up after the fact; this is about not needing it.
 */
const { RUN_CEILING_MS, REAP_GRACE_MS } = await import("../lib/pipeline/reap.js");
const { scansFor, SECONDS_PER_COMPANY, passesNeeded, companiesPerPass } =
  await import("../lib/pipeline/scan-limits.js");

let pass = 0;
const fail: string[] = [];
const check = (name: string, fn: () => void) => {
  try { fn(); pass++; } catch (e) { fail.push(`${name}: ${(e as Error).message}`); }
};
const ok = (c: boolean, m: string) => { if (!c) throw new Error(m); };

// Mirrors the orchestrator's own constants.
const DEADLINE_MARGIN_MS = 45_000;
const deadlineBudget = Math.max(30_000, RUN_CEILING_MS - DEADLINE_MARGIN_MS);

check("the self-imposed deadline lands before the platform ceiling", () => {
  ok(deadlineBudget < RUN_CEILING_MS, "deadline must be earlier than the ceiling");
  ok(RUN_CEILING_MS - deadlineBudget >= 30_000, "needs >=30s of tail for in-flight work and final writes");
});

check("the margin covers a worst-case in-flight company plus the final writes", () => {
  // One classify+disprove can run ~15s; the closing writes a few seconds more.
  ok(DEADLINE_MARGIN_MS >= 15_000 + 5_000, "margin too tight for the tail");
});

check("a round cannot overshoot the deadline, because the pool stops per item", () => {
  // 15 companies at ~5.2s with concurrency 5 is ~16s of wall clock; the point
  // is that the check is per ITEM, so the worst overshoot is one company.
  const worstOvershootMs = SECONDS_PER_COMPANY * 1000;
  ok(worstOvershootMs < DEADLINE_MARGIN_MS, "one company must fit inside the margin");
});

check("the reaper still fires later than the run's own deadline", () => {
  // Otherwise the reaper would close out a run that is alive and about to
  // finish cleanly, which is the exact failure it exists to prevent.
  ok(RUN_CEILING_MS + REAP_GRACE_MS > deadlineBudget, "reaper must not pre-empt a live run");
});

check("a target that fits is not cut short by the deadline", () => {
  const secs = scansFor(8) * SECONDS_PER_COMPANY;
  ok(secs * 1000 < deadlineBudget, `target 8 needs ${secs}s, budget is ${deadlineBudget / 1000}s`);
  ok(passesNeeded(8, RUN_CEILING_MS) === 1, "target 8 should be a single pass");
});

check("a target that does not fit reports more than one pass", () => {
  ok(passesNeeded(20, RUN_CEILING_MS) > 1, "target 20 must not claim a single pass");
  ok(passesNeeded(50, RUN_CEILING_MS) >= passesNeeded(20, RUN_CEILING_MS), "passes must be monotonic");
});

check("companiesPerPass matches the ceiling and the measured rate", () => {
  const n = companiesPerPass(RUN_CEILING_MS);
  ok(n > 0, "must be positive");
  ok(Math.abs(n - RUN_CEILING_MS / 1000 / SECONDS_PER_COMPANY) < 1, "should follow ceiling / rate");
});

check("a tiny ceiling still leaves a usable floor rather than zero", () => {
  // If someone sets maxDuration very low, the run must still attempt work
  // instead of computing a deadline in the past and doing nothing.
  const tiny = Math.max(30_000, 10_000 - DEADLINE_MARGIN_MS);
  ok(tiny === 30_000, "floor must clamp to 30s");
});

if (fail.length) {
  console.error(`${fail.length} FAILED:`);
  for (const f of fail) console.error("  " + f);
  process.exit(1);
}
console.log(`${pass}/${pass} deadline assertions passed`);
