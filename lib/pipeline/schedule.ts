import { getSettingFresh, setSetting } from "../settings";
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
  industries: ["landscaping", "home_builder"],
  states: [...AGREED_STATES],
  // 10, not 20. Two verticals at 20 reads 1,032 Firecrawl pages a month against
  // a 1,025 quota — the shipped default was over the limit every month. 10 is
  // 516, which leaves room for manual searches on top.
  targetPerRun: 10,
  mode: "hybrid",
  // Same baseline the one-off form defaults to, so a scheduled scan and a
  // manual one for the same thing return the same companies.
  revenueMinMusd: 3,
  revenueMaxMusd: 15,
  refinement: null,
  lastRunOn: null,
};

const VALID_MODES: SearchMode[] = ["signal", "filter", "hybrid"];
const VALID_INDUSTRIES: Industry[] = ["landscaping", "home_builder"];

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
