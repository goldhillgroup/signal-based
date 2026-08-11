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
   * told. Reaches both ends of the pipeline, exactly like the manual form:
   * classification treats it as a non-overriding hint, and discovery turns it
   * into quoted queries anchored to the trade (refinementQueries). The old
   * worry — free text dragging a run off the agreed vertical — is handled by
   * the vertical and states staying hard filters, so the focus only decides
   * what is ASKED within them.
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
 * Weekly. The cadence is fine; the SIZE was the problem.
 *
 * A harvest spends Apify, Tavily, Firecrawl and OpenRouter. It does NOT spend
 * AnymailFinder or MillionVerifier — those are the manual enrichment step, and
 * nothing in the harvest path calls them. So the binding constraint is
 * Firecrawl's monthly page quota, and it depends entirely on the target:
 *
 *   target  companies/run  pages/month  vs 1,025 quota
 *     10        120            516      fits
 *     15        180            774      fits
 *     18        216            929      fits
 *     20        240          1,032      OVER
 *     50        480          2,064      OVER
 *
 * So a weekly harvest is affordable up to a target of 19 across two verticals,
 * and the shipped default of 20 was one notch past it. Capping the target is
 * the right fix rather than stretching the cadence — weekly is what makes the
 * product feel alive, and the overspend was never about how often it ran.
 */
const CADENCE_DAYS = 7;

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
  return `Weekly harvest: ${what}, ${when}`;
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
/**
 * How long the harvest's actual driver allows.
 *
 * NOT the Vercel function ceiling. The harvest runs in GitHub Actions — see
 * .github/workflows/weekly-harvest.yml, whose job timeout is 90 minutes — and
 * vercel.json has no cron block, because at 300s that driver could only ever
 * half-finish a harvest and would still consume the week.
 *
 * The schedule screen used to warn against the 300s ceiling, which was correct
 * when Vercel drove it and became misleading the moment Actions did: it told
 * someone a perfectly runnable harvest would be cut off.
 */
export const HARVEST_CEILING_MS = 90 * 60_000;

/** Firecrawl's monthly page allowance — the binding limit on harvest size. */
export const FIRECRAWL_PAGES_PER_MONTH = 1025;
/** Weeks in a month, for turning a per-run figure into a monthly one. */
const RUNS_PER_MONTH = 4.3;

/**
 * Pages a weekly harvest of this shape consumes per month, and whether that
 * fits. The harvest reads one page per company; enrichment is a separate,
 * manual step and is not counted here because no harvest path calls it.
 */
export function monthlyPageUse(
  targetPerRun: number,
  verticals: number,
  // The harvest runs in hybrid mode, which now reads about twenty companies
  // per confirmed pair rather than six per ICP fit. Estimating with the fit
  // multiplier would understate the Firecrawl bill by more than 3x and quietly
  // blow the monthly quota — the exact failure this function exists to prevent.
  seekingSignals = true
): { pages: number; quota: number; fits: boolean; maxTargetThatFits: number } {
  const n = Math.max(verticals, 1);
  const pages = scansFor(targetPerRun, seekingSignals) * n * RUNS_PER_MONTH;
  let maxTargetThatFits = 0;
  for (let t = 1; t <= 100; t++) {
    if (scansFor(t, seekingSignals) * n * RUNS_PER_MONTH <= FIRECRAWL_PAGES_PER_MONTH) maxTargetThatFits = t;
  }
  return { pages, quota: FIRECRAWL_PAGES_PER_MONTH, fits: pages <= FIRECRAWL_PAGES_PER_MONTH, maxTargetThatFits };
}

export function harvestEstimate(
  targetPerRun: number,
  verticals: number,
  ceilingMs: number,
  seekingSignals = true
): { minutes: number; fits: boolean; perVerticalMinutes: number; maxTargetThatFits: number } {
  const perVerticalSeconds = scansFor(targetPerRun, seekingSignals) * SECONDS_PER_COMPANY;
  const n = Math.max(verticals, 1);
  const totalSeconds = perVerticalSeconds * n;

  // Largest target whose whole harvest still fits, for the message.
  let maxTargetThatFits = 0;
  for (let t = 1; t <= 100; t++) {
    if (scansFor(t, seekingSignals) * SECONDS_PER_COMPANY * n * 1000 <= ceilingMs) maxTargetThatFits = t;
  }

  return {
    minutes: totalSeconds / 60,
    perVerticalMinutes: perVerticalSeconds / 60,
    fits: totalSeconds * 1000 <= ceilingMs,
    maxTargetThatFits,
  };
}
