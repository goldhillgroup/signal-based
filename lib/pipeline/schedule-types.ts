import { scansFor, SECONDS_PER_COMPANY } from "./scan-limits";
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
 * A daily ping with a "have I already run recently enough?" test self-heals:
 * the anchor day fails, the next ping sees the gap and runs.
 *
 * `dayOfWeek` is therefore the EARLIEST preferred day, not a hard gate.
 */
/**
 * MONTHLY, not weekly, and the reason is the vendors rather than the leads.
 *
 * Measured against the real quotas at the shipped default (2 verticals, 20
 * companies each = 240 companies per harvest):
 *
 *              weekly (4.3/mo)     monthly (1/mo)
 *   companies  1,032               240
 *   cost       $21.88/mo, $262/yr  $5.09/mo, $61/yr
 *   Firecrawl  1,032 of 1,025      240 of 1,025
 *   AnymailFdr 365 credits: 2.1mo  9.1 months
 *
 * Weekly EXCEEDS the Firecrawl page quota every month and burns the
 * AnymailFinder balance in two. Monthly fits every vendor with room, at a
 * quarter of the cost — and for a signal that changes on the timescale of a
 * son or daughter joining the business, a month is the honest cadence anyway.
 */
const CADENCE_DAYS = 28;

/**
 * Off-day catch-up. Past this many days the harvest stops holding out for its
 * preferred weekday and runs on the next ping, whatever day that is.
 *
 * CADENCE + 3: long enough that the anchor day gets a fair chance to come
 * round, short enough that one bad deploy does not cost a whole extra month.
 */
const CATCH_UP_DAYS = CADENCE_DAYS + 3;

/**
 * Minimum gap when it IS the preferred day.
 *
 * What makes the schedule self-correcting. Its whole job is the case AFTER an
 * off-day catch-up: a catch-up on the 30th sets lastRunOn to the 30th, and a
 * full 28-day cooldown would then skip the next anchor day and push the
 * schedule out by another month. At 21 days the next anchor runs and the
 * cadence is back where it belongs.
 *
 * Three weeks, not two: it must never be small enough to allow two harvests
 * inside one month, which is exactly the overspend this cadence exists to
 * prevent.
 */
const PREFERRED_DAY_MIN_DAYS = 21;

export function shouldRunNow(
  s: WeeklySchedule,
  now: Date
): { run: boolean; reason: string } {
  if (!s.enabled) return { run: false, reason: "Monthly harvest is switched off." };
  if (s.states.length === 0 || s.industries.length === 0) {
    return { run: false, reason: "Nothing configured to scan." };
  }

  const today = isoDay(now);
  if (s.lastRunOn === today) return { run: false, reason: "Already ran today." };

  if (s.lastRunOn) {
    const days = daysBetween(s.lastRunOn, today);
    // The cooldown IS the spend limit. A month of nothing changing is the whole
    // reason not to re-ask sooner — see recheck-policy.ts, which applies the
    // same idea per company.
    const isPreferredDay = now.getDay() === s.dayOfWeek;

    // On the anchor day, a short gap is enough — see PREFERRED_DAY_MIN_DAYS.
    if (isPreferredDay && days >= PREFERRED_DAY_MIN_DAYS) {
      return { run: true, reason: `${days} days since the last run.` };
    }
    if (days < CADENCE_DAYS) {
      return {
        run: false,
        reason: `Ran ${days} day${days === 1 ? "" : "s"} ago, waits ${CADENCE_DAYS}.`,
      };
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
  return `Monthly harvest: ${what}, ${when}`;
}


/**
 * Whether a harvest can actually FINISH inside the server's function ceiling.
 *
 * The cron runs one pipeline per vertical SEQUENTIALLY inside a single
 * invocation, so the cost of the whole harvest is per-vertical time multiplied
 * by the number of verticals — and nothing anywhere checked that against the
 * ceiling. The shipped default (both verticals, 20 companies each) needs about
 * 21 minutes against a 13.3-minute ceiling, so the SECOND vertical was being
 * killed roughly halfway through, every week, silently. reapStaleRuns closes
 * the row out honestly, which is why it looked like a short week rather than a
 * bug.
 *
 * 5.2 s/company is measured end to end (fetch + classify + disprove), not
 * estimated. The scan ceiling mirrors the orchestrator's own so the two cannot
 * drift.
 */
export function harvestEstimate(
  targetPerRun: number,
  verticals: number,
  ceilingMs: number
): { minutes: number; fits: boolean; perVerticalMinutes: number; maxTargetThatFits: number } {
  const perVerticalSeconds = scansFor(targetPerRun) * SECONDS_PER_COMPANY;
  const n = Math.max(verticals, 1);
  const totalSeconds = perVerticalSeconds * n;

  // Largest target whose whole harvest still fits, for the message.
  let maxTargetThatFits = 0;
  for (let t = 1; t <= 100; t++) {
    if (scansFor(t) * SECONDS_PER_COMPANY * n * 1000 <= ceilingMs) maxTargetThatFits = t;
  }

  return {
    minutes: totalSeconds / 60,
    perVerticalMinutes: perVerticalSeconds / 60,
    fits: totalSeconds * 1000 <= ceilingMs,
    maxTargetThatFits,
  };
}
