import { getSettingFresh, setSetting } from "../settings";
import { VALID_INDUSTRIES } from "./intake-types";
import { AGREED_STATES } from "./us-states";
import type { WeeklySchedule } from "./schedule-types";
import type { Industry, SearchMode } from "../supabase/types";

/**
 * SERVER-ONLY half of the weekly harvest. Reads and writes the stored config.
 *
 * Anything a Client Component needs at runtime lives in ./schedule-types —
 * this file reaches lib/supabase/server and therefore `next/headers`, and
 * importing a VALUE from here into a client component drags that whole chain
 * into the browser bundle. (It did exactly that once; see schedule-types.ts.)
 *
 * WEEKLY, not daily, and that is a cost decision as much as a product one.
 * Three of the four vendors renew monthly, so a daily job gets ~30 chances a
 * month to overspend and a monthly job gets 4-5. Four predictable runs can be
 * budgeted precisely; thirty ad-hoc ones cannot. It also matches the signal:
 * a founder's son joining the business is not a daily event, and re-asking the
 * same slice every 24 hours mostly re-buys yesterday's answer.
 *
 * Config lives in `app_settings` as one JSON blob rather than its own table.
 * That table already exists with service-role-only RLS, which is exactly the
 * posture this needs — and migrations here have to be pasted into the Supabase
 * SQL editor by hand (the direct Postgres route is dead in this environment),
 * so avoiding one is worth real time.
 */

export const SCHEDULE_KEY = "WEEKLY_HARVEST";

export const DEFAULT_SCHEDULE: WeeklySchedule = {
  enabled: false, // never starts spending on its own, has to be switched on
  dayOfWeek: 1, // Monday: results are waiting at the start of his week
  // The two verticals the delivered proof covers, NOT all eight. The harvest
  // spends on its own schedule against a fixed Firecrawl quota, so widening it
  // silently multiplies a bill nobody is watching — 516 pages a month at two
  // verticals becomes 2,064 at eight. The one-off search form is where the
  // full ICP is reachable, because a person is standing there choosing it.
  // Jonathan can add verticals here himself; the estimate line below says what
  // each one costs before he saves.
  industries: ["landscaping", "home_builder"],
  states: [...AGREED_STATES],
  // 5, not 10 — and the reason is worth keeping, because the number has now
  // moved twice for the same underlying mistake.
  //
  // It was 20, which read 1,032 pages a month against a 1,025 quota: over the
  // limit every month. It became 10, computed at six companies read per
  // result. But the harvest runs in HYBRID mode, and hybrid counts confirmed
  // founder-and-successor pairs, which arrive about one in twenty — so the
  // real figure was 1,720 pages, 168% of the allowance. tests/quota caught it.
  //
  // At 3 across both verticals it is 516 pages of 1,025 — half the allowance
  // left for the manual searches that are the actual product. 5 would fit at
  // 84%, which technically passes and leaves almost nothing for a person
  // pressing Search.
  //
  // A handful of pairs a month from a job nobody has to run is the honest
  // shape of this feature. The number is small because the signal is rare,
  // not because the harvest is weak.
  targetPerRun: 3,
  mode: "hybrid",
  // Same baseline the one-off form defaults to, so a scheduled scan and a
  // manual one for the same thing return the same companies.
  // $5-15M, the sweet spot from the written ICP — not the full $5-30M.
  //
  // These were 3 and 15, the earlier brief, left behind when DEFAULT_ICP and
  // the classifier both moved. A scheduled job nobody watches should aim at
  // the middle of the profile rather than its edges: the wider band is one
  // click away here, and a person setting it is making a deliberate choice.
  revenueMinMusd: 5,
  revenueMaxMusd: 15,
  refinement: null,
  lastRunOn: null,
};

const VALID_MODES: SearchMode[] = ["signal", "filter", "hybrid"];
// Imported, never redeclared. This was a local copy frozen at two verticals,
// and it is the most damaging place to have had one: it FILTERS a schedule on
// read, so a harvest Jonathan saved for specialty trades would come back with
// that vertical silently removed — his setting gone, with nothing to explain
// where. tests/icp-updated guards the shape of this bug now, not the instance.

/**
 * Always returns a usable schedule. A missing row, malformed JSON or a field
 * of the wrong type all fall back to the default rather than throwing — this
 * is read by a cron with nobody watching, and the safe failure is "do not
 * run", never "crash the endpoint".
 */
export async function getSchedule(): Promise<WeeklySchedule> {
  const raw = await getSettingFresh(SCHEDULE_KEY);
  if (!raw) return { ...DEFAULT_SCHEDULE };
  try {
    const p = JSON.parse(raw) as Partial<WeeklySchedule>;
    const industries = Array.isArray(p.industries)
      ? p.industries.filter((i): i is Industry => VALID_INDUSTRIES.includes(i))
      : DEFAULT_SCHEDULE.industries;
    const states = Array.isArray(p.states)
      ? p.states.filter((s): s is string => typeof s === "string" && /^[A-Z]{2}$/.test(s))
      : DEFAULT_SCHEDULE.states;
    return {
      enabled: p.enabled === true,
      dayOfWeek:
        typeof p.dayOfWeek === "number" && p.dayOfWeek >= 0 && p.dayOfWeek <= 6
          ? Math.floor(p.dayOfWeek)
          : DEFAULT_SCHEDULE.dayOfWeek,
      // Empty stays EMPTY — do not substitute the defaults here. Falling back
      // to "all four agreed states" would invent scope for a job that spends
      // money: a stored config with no states would quietly harvest CA/NY/TX/FL
      // instead of refusing. shouldRunNow() treats empty as "nothing to scan"
      // and declines, which is the only safe reading. The defaults belong on a
      // schedule that has never been configured (see the !raw branch above),
      // not on one that was configured down to nothing.
      industries,
      states,
      targetPerRun:
        typeof p.targetPerRun === "number" && p.targetPerRun > 0
          ? Math.min(Math.floor(p.targetPerRun), 100)
          : DEFAULT_SCHEDULE.targetPerRun,
      mode: VALID_MODES.includes(p.mode as SearchMode)
        ? (p.mode as SearchMode)
        : DEFAULT_SCHEDULE.mode,
      // A band absent from stored JSON means the schedule predates this field,
      // and what it actually DID was run unbounded. Reading it as null keeps
      // that exact behaviour rather than silently applying a band to a job
      // that has been running without one — a stored config must never change
      // what it does because the code around it grew a feature.
      // Trimmed and length-capped here rather than trusted: this string is
      // read by a cron with nobody watching and goes straight into a prompt.
      refinement:
        typeof p.refinement === "string" && p.refinement.trim()
          ? p.refinement.trim().slice(0, 200)
          : null,
      revenueMinMusd: typeof p.revenueMinMusd === "number" ? p.revenueMinMusd : null,
      revenueMaxMusd: typeof p.revenueMaxMusd === "number" ? p.revenueMaxMusd : null,
      lastRunOn: typeof p.lastRunOn === "string" ? p.lastRunOn : null,
    };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

export async function saveSchedule(next: WeeklySchedule): Promise<void> {
  await setSetting(SCHEDULE_KEY, JSON.stringify(next));
}

export type { WeeklySchedule };
