/**
 * The weekly harvest actually landing on Mondays.
 *
 * This feature was fully built and completely inert: a toggle, a route, a
 * persisted setting, and no scheduler anywhere — switching it on did nothing,
 * silently, forever. These assert the decision the route makes on each daily
 * ping, so "every Monday" is a tested claim rather than an intention.
 */
import { shouldRunNow, isoDay, DAY_NAMES } from "./lib/pipeline/schedule-types.js";

const base = {
  enabled: true,
  dayOfWeek: 1, // Monday
  industries: ["landscaping"] as const,
  states: ["TN"],
  targetSignals: 10,
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

// ── a missed Monday self-heals rather than losing a fortnight ─────────────
const missed = cfg({ lastRunOn: "2026-08-03" }); // ran two Mondays ago
ok("a missed Monday runs on the next ping", shouldRunNow(missed, TUE).run,
   shouldRunNow(missed, TUE).reason);

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
