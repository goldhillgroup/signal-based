import type { Industry, SearchMode } from "../supabase/types";

/**
 * The client-safe half of the weekly schedule.
 *
 * Split out from schedule.ts because that module reaches getSetting/setSetting
 * -> lib/supabase/server -> `next/headers`, which is server-only. The Settings
 * card is a Client Component and imports DAY_NAMES as a VALUE, so importing it
 * from schedule.ts dragged the whole server chain into the browser bundle and
 * broke the build with "You're importing a module that depends on next/headers".
 *
 * Types alone would have been fine — those are erased. Anything a client
 * component needs at RUNTIME has to live here, not there.
 */

export interface WeeklySchedule {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. The cron fires daily and this decides whether it acts. */
  dayOfWeek: number;
  industries: Industry[];
  states: string[];
  /** Leads wanted per run. The real ceiling is the budget, not this. */
  targetPerRun: number;
  mode: SearchMode;
  /**
   * Revenue band, matching the one-off search form.
   *
   * The harvest had none: the cron passed { min: null, max: null } hardcoded,
   * so every scheduled scan ran unbounded while the manual form defaulted to
   * $3-15M. The same request produced different companies depending on which
   * screen asked for it, and nothing on either screen said so.
   *
   * Nullable both ways, and both null legitimately means "no limit" — so a
   * schedule saved before this existed keeps behaving exactly as it did.
   */
  revenueMinMusd: number | null;
  revenueMaxMusd: number | null;
  /**
   * Free-text signal focus, the same field the one-off search form has.
   *
   * The harvest could set the vertical, the states, the band and the mode —
   * every structured input — but not this one, so the only thing a person can
   * say in their own words was the one thing a scheduled run could not be
   * told. Passed to classification as a non-overriding hint; like the manual
   * form it deliberately does NOT steer discovery, because letting free text
   * choose which companies get FOUND is how a search drifts off the agreed
   * vertical.
   */
  refinement: string | null;
  /** ISO date (YYYY-MM-DD) of the last run that actually started. */
  lastRunOn: string | null;
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Local calendar day — same reasoning as app/dashboard/all-leads. */
export function isoDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split("-").map(Number);
  const [y2, m2, d2] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/**
 * Should the harvest run right now?
 *
 * The cron pings DAILY and this decides. That is deliberate: a weekly cron
 * expression that misses its window — a deploy, an outage, a cold platform —
 * silently skips a whole week and nobody notices until the folder is missing.
 * A daily ping with a "have I already run in the last 7 days?" test self-heals:
 * Monday fails, Tuesday's ping sees the gap and runs.
 *
 * `dayOfWeek` is therefore the EARLIEST preferred day, not a hard gate.
 */
/**
 * Off-day catch-up. Past this many days the harvest stops holding out for its
 * preferred weekday and runs on the next ping, whatever day that is.
 *
 * 10, not 14: a fortnight means a whole extra Monday passes before anything
 * happens, which is a full week of leads lost to one bad deploy.
 */
const CATCH_UP_DAYS = 10;

/**
 * Minimum gap when it IS the preferred day.
 *
 * Deliberately small, and it is what makes the schedule self-correcting. The
 * preferred day only comes round every 7 days, so this can never cause two
 * runs in a week by itself — its whole job is the case AFTER an off-day
 * catch-up. A catch-up on Thursday sets lastRunOn to Thursday; the next Monday
 * is then only 4 days later, and a 7-day cooldown would skip it and push the
 * schedule out to the Monday after. With this, that Monday runs and the
 * cadence is back on its anchor immediately.
 */
const PREFERRED_DAY_MIN_DAYS = 2;

export function shouldRunNow(
  s: WeeklySchedule,
  now: Date
): { run: boolean; reason: string } {
  if (!s.enabled) return { run: false, reason: "Weekly harvest is switched off." };
  if (s.states.length === 0 || s.industries.length === 0) {
    return { run: false, reason: "Nothing configured to scan." };
  }

  const today = isoDay(now);
  if (s.lastRunOn === today) return { run: false, reason: "Already ran today." };

  if (s.lastRunOn) {
    const days = daysBetween(s.lastRunOn, today);
    // The cooldown IS the weekly limit. Seven days of nothing changing is the
    // whole reason not to re-ask sooner — see recheck-policy.ts, which applies
    // the same idea per company.
    const isPreferredDay = now.getDay() === s.dayOfWeek;

    // On the anchor day, a short gap is enough — see PREFERRED_DAY_MIN_DAYS.
    if (isPreferredDay && days >= PREFERRED_DAY_MIN_DAYS) {
      return { run: true, reason: `${days} days since the last run.` };
    }
    if (days < 7) {
      return { run: false, reason: `Ran ${days} day${days === 1 ? "" : "s"} ago, waits 7.` };
    }
    // MONDAY IS AN ANCHOR, NOT A STARTING GUN.
    //
    // This used to run on the next ping past day 7, whatever weekday that was
    // — which quietly destroys "every Monday". One run displaced by a day (a
    // deploy, an outage, an exhausted balance) lands on a Tuesday, and every
    // run after it is a Tuesday, because each new lastRunOn re-anchors the
    // cooldown to the wrong day. The schedule drifts one day per incident and
    // never comes back.
    //
    // So: past the cooldown, wait for the chosen day. The catch-up below is
    // what stops that becoming a fortnight — if a whole preferred day has been
    // missed as well, run on the next ping regardless and let the day after
    // that re-anchor.
    if (days >= CATCH_UP_DAYS) {
      return {
        run: true,
        reason: `${days} days since the last run, past the ${DAY_NAMES[s.dayOfWeek]} it should have used.`,
      };
    }
    return {
      run: false,
      reason: `Ran ${days} days ago, next ${DAY_NAMES[s.dayOfWeek]}.`,
    };
  }

  // Never run before: wait for the preferred weekday so the first harvest
  // lands where he expects it rather than the moment he saves the setting.
  if (now.getDay() !== s.dayOfWeek) {
    return { run: false, reason: `First run waits for ${DAY_NAMES[s.dayOfWeek]}.` };
  }
  return { run: true, reason: "First scheduled run." };
}

/** "Weekly harvest — Landscaping, Aug 10" — the label that becomes the folder. */
export function weeklyLabel(industry: Industry, now: Date): string {
  const when = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const what = industry === "home_builder" ? "Home builders" : "Landscaping";
  return `Weekly harvest: ${what}, ${when}`;
}
