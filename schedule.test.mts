/**
 * Every branch of the weekly-harvest decision, before a single dollar is spent.
 *
 * shouldRunNow() is the one function standing between "a schedule exists" and
 * "money leaves the account on a timer". It is pure, so it can be exhausted
 * cheaply — and it must be, because its failure modes are asymmetric: refusing
 * to run costs a week's leads, running when it shouldn't costs real money and
 * can do so repeatedly before anyone notices.
 */
import { shouldRunNow, isoDay, daysBetween, weeklyLabel } from "./lib/pipeline/schedule-types.js";
import type { WeeklySchedule } from "./lib/pipeline/schedule-types.js";

const base: WeeklySchedule = {
  enabled: true,
  dayOfWeek: 1, // Monday
  industries: ["landscaping"],
  states: ["CA"],
  targetPerRun: 10,
  mode: "hybrid",
  lastRunOn: null,
};

// 2026-08-07 is a Friday. Anchors below are built off known weekdays.
const MON = new Date(2026, 7, 10, 9, 0); // Aug 10 2026 = Monday
const TUE = new Date(2026, 7, 11, 9, 0);
const FRI = new Date(2026, 7, 7, 9, 0);

let pass = 0;
const fails: string[] = [];

function check(name: string, got: boolean, want: boolean, extra = "") {
  if (got === want) pass++;
  else fails.push(`${name} — wanted run=${want}, got run=${got} ${extra}`);
}

// ── The off switch is absolute ─────────────────────────────────────────────
check("disabled never runs", shouldRunNow({ ...base, enabled: false }, MON).run, false);
check(
  "disabled beats an overdue cooldown",
  shouldRunNow({ ...base, enabled: false, lastRunOn: "2026-01-01" }, MON).run,
  false
);

// ── Nothing configured is not a reason to run ──────────────────────────────
check("no states -> no run", shouldRunNow({ ...base, states: [] }, MON).run, false);
check("no industries -> no run", shouldRunNow({ ...base, industries: [] }, MON).run, false);

// ── First-ever run waits for the chosen weekday ────────────────────────────
check("never run, right weekday -> runs", shouldRunNow(base, MON).run, true);
check("never run, wrong weekday -> waits", shouldRunNow(base, TUE).run, false);
check("never run, Friday with Monday set -> waits", shouldRunNow(base, FRI).run, false);
check(
  "never run, dayOfWeek=Friday on a Friday -> runs",
  shouldRunNow({ ...base, dayOfWeek: 5 }, FRI).run,
  true
);

// ── The 7-day cooldown IS the weekly limit ─────────────────────────────────
check("already ran today -> no", shouldRunNow({ ...base, lastRunOn: isoDay(MON) }, MON).run, false);
check("ran 1 day ago -> no", shouldRunNow({ ...base, lastRunOn: "2026-08-09" }, MON).run, false);
check("ran 6 days ago -> no", shouldRunNow({ ...base, lastRunOn: "2026-08-04" }, MON).run, false);
check("ran exactly 7 days ago -> YES", shouldRunNow({ ...base, lastRunOn: "2026-08-03" }, MON).run, true);
check("ran 30 days ago -> YES", shouldRunNow({ ...base, lastRunOn: "2026-07-11" }, MON).run, true);

// ── Self-healing: a missed Monday must not cost the whole week ─────────────
// This is the reason the cron pings daily instead of using a weekly cron
// expression. Once past the cooldown it runs on the NEXT ping, whatever day.
check(
  "overdue on a Tuesday still runs (missed Monday)",
  shouldRunNow({ ...base, lastRunOn: "2026-08-03" }, TUE).run,
  true
);
check(
  "overdue on a Friday still runs",
  shouldRunNow({ ...base, lastRunOn: "2026-07-20" }, FRI).run,
  true
);

// ── It must never run twice in one day, on any path ────────────────────────
// The cron stamps lastRunOn before doing work precisely so a duplicate ping
// is a no-op. Prove the second call refuses.
{
  const after = { ...base, lastRunOn: isoDay(MON) };
  check("second ping same day -> no", shouldRunNow(after, MON).run, false);
  const laterSameDay = new Date(2026, 7, 10, 23, 59);
  check("ping at 23:59 same day -> no", shouldRunNow(after, laterSameDay).run, false);
}

// ── Date maths ─────────────────────────────────────────────────────────────
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) pass++;
  else fails.push(`${name} — wanted ${want}, got ${got}`);
}
eq("daysBetween same day", daysBetween("2026-08-10", "2026-08-10"), 0);
eq("daysBetween 7", daysBetween("2026-08-03", "2026-08-10"), 7);
eq("daysBetween across a month", daysBetween("2026-07-28", "2026-08-04"), 7);
// DST: US clocks go back 2026-11-01. A naive (b-a)/86400000 on local Date
// objects would return 7.04 and round wrong; this uses Date.UTC, so it holds.
eq("daysBetween across DST", daysBetween("2026-10-28", "2026-11-04"), 7);
eq("isoDay pads single digits", isoDay(new Date(2026, 0, 5, 12)), "2026-01-05");
// isoDay must be LOCAL, not UTC — an evening run in LA is still today.
eq("isoDay is local not UTC", isoDay(new Date(2026, 7, 10, 23, 30)), "2026-08-10");

// ── Folder labels: topic first, date as a specification ────────────────────
eq("label names the vertical", weeklyLabel("landscaping", MON), "Weekly harvest — Landscaping, Aug 10");
eq("label for builders", weeklyLabel("home_builder", MON), "Weekly harvest — Home builders, Aug 10");
{
  const a = weeklyLabel("landscaping", MON);
  const b = weeklyLabel("home_builder", MON);
  eq("two verticals on one day get distinct folders", a !== b, true);
}

const total = pass + fails.length;
console.log(`\n${pass}/${total} passed`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
