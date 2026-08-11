/**
 * The weekly harvest actually landing on Mondays.
 *
 * This feature was fully built and completely inert: a toggle, a route, a
 * persisted setting, and no scheduler anywhere — switching it on did nothing,
 * silently, forever. These assert the decision the route makes on each daily
 * ping, so "every Monday" is a tested claim rather than an intention.
 */
import { shouldRunNow, isoDay, DAY_NAMES } from "../lib/pipeline/schedule-types.js";

const base = {
  enabled: true,
  dayOfWeek: 1, // Monday
  industries: ["landscaping"] as const,
  states: ["TN"],
  targetSignals: 10,
  refinement: null as string | null,
  revenueMinMusd: 3 as number | null,
  revenueMaxMusd: 15 as number | null,
  lastRunOn: null as string | null,
  lastError: null as string | null,
};
const cfg = (o: Partial<typeof base>) => ({ ...base, ...o }) as never;

// Real Mondays and their neighbours, midday UTC — the hour the cron fires.
const MON = new Date("2026-08-10T13:00:00Z");
const TUE = new Date("2026-08-11T13:00:00Z");
const SUN = new Date("2026-08-09T13:00:00Z");
const NEXT_MON = new Date("2026-08-17T13:00:00Z");

let pass = 0;
const fails: string[] = [];
function ok(label: string, cond: boolean, detail = "") {
  if (cond) pass++; else fails.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

ok("day 1 really is Monday", DAY_NAMES[1] === "Monday", DAY_NAMES[1]);
ok("the cron hour lands on Monday in UTC", MON.getUTCDay() === 1);

// ── never run before: waits for Monday ────────────────────────────────────
ok("Sunday ping does not run", !shouldRunNow(cfg({}), SUN).run, shouldRunNow(cfg({}), SUN).reason);
ok("Monday ping runs", shouldRunNow(cfg({}), MON).run, shouldRunNow(cfg({}), MON).reason);
ok("Tuesday ping does not run before a first run",
   !shouldRunNow(cfg({}), TUE).run, shouldRunNow(cfg({}), TUE).reason);

// ── after a Monday run, the next one is the following Monday ──────────────
const ranMon = cfg({ lastRunOn: isoDay(MON) });
ok("does not run twice on the same Monday", !shouldRunNow(ranMon, MON).run);
ok("does not run on Tuesday", !shouldRunNow(ranMon, TUE).run);
ok("does not run mid-week", !shouldRunNow(ranMon, new Date("2026-08-13T13:00:00Z")).run);
ok("does not run on day six", !shouldRunNow(ranMon, new Date("2026-08-16T13:00:00Z")).run);
ok("RUNS on the next Monday", shouldRunNow(ranMon, NEXT_MON).run,
   shouldRunNow(ranMon, NEXT_MON).reason);

// ── MONDAY IS AN ANCHOR: a run past the cooldown still waits for Monday ───
// Without this the schedule drifts a day per incident and never returns.
const ranTue = cfg({ lastRunOn: "2026-08-04" }); // a Tuesday
ok("does not fire on the following Tuesday just because 7 days passed",
   !shouldRunNow(ranTue, new Date("2026-08-11T13:00:00Z")).run,
   shouldRunNow(ranTue, new Date("2026-08-11T13:00:00Z")).reason);
ok("returns to Monday", shouldRunNow(ranTue, new Date("2026-08-17T13:00:00Z")).run,
   shouldRunNow(ranTue, new Date("2026-08-17T13:00:00Z")).reason);

// ── but a long gap catches up rather than waiting out another week ────────
const stale = cfg({ lastRunOn: "2026-07-28" }); // 12 days before TUE
ok("a 12-day gap runs on the next ping, whatever day",
   shouldRunNow(stale, TUE).run, shouldRunNow(stale, TUE).reason);
ok("a 6-day gap still waits", !shouldRunNow(cfg({ lastRunOn: "2026-08-05" }), TUE).run);

// ── off means off ─────────────────────────────────────────────────────────
ok("disabled never runs", !shouldRunNow(cfg({ enabled: false }), MON).run);
ok("no states never runs", !shouldRunNow(cfg({ states: [] }), MON).run);
ok("no industries never runs", !shouldRunNow(cfg({ industries: [] as never }), MON).run);

// ── the reason is always sayable, since the UI shows it ───────────────────
for (const [name, d] of [["sun", SUN], ["mon", MON], ["tue", TUE]] as const) {
  ok(`${name} gives a reason`, shouldRunNow(cfg({}), d).reason.length > 0);
}

console.log(`${pass}/${pass + fails.length} harvest assertions passed`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
