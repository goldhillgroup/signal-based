import { createServiceRoleClient } from "@/lib/supabase/server";
import { runSearchPipeline } from "./orchestrator";
import { getSchedule, saveSchedule } from "./schedule";
import { shouldRunNow, isoDay, weeklyLabel } from "./schedule-types";
import { preflightBlocker, creditBlockerFor, recordHarvestHealth } from "./preflight";
import { stateNameFor } from "./us-states";
import type { Industry } from "@/lib/supabase/types";

/**
 * The monthly harvest, split in two so it can be driven by either a serverless
 * function or a plain CI job.
 *
 * WHY THE SPLIT. Deciding whether to run, checking credit and creating the
 * folders takes under a second. Actually crawling takes ten to twenty minutes.
 * On Vercel the second half has to be handed to `after()` and is then bounded
 * by the function's maxDuration — 300s on every plan by default, and the reason
 * a two-vertical harvest was being killed halfway through every month. In GitHub
 * Actions there is no such ceiling (a job may run for six hours), so the same
 * work can simply be awaited.
 *
 * Splitting it means both drivers run byte-for-byte the same logic. The
 * alternative — a script that reimplements the route — is the kind of thing
 * that agrees on the day it is written and diverges by the third change.
 *
 * SAFE TO DRIVE FROM BOTH AT ONCE. planHarvest stamps lastRunOn BEFORE any
 * crawling starts, so whichever driver arrives first claims the day and the
 * other reads "already ran" and does nothing. Running the Vercel cron and a
 * GitHub schedule together is therefore a belt-and-braces setup, not a
 * double-booking: two independent chances to catch the week, one harvest.
 */

export interface HarvestPlan {
  ran: boolean;
  reason: string;
  /** Folders created and waiting to be crawled. Empty when ran is false. */
  started: { id: string; label: string; industry: Industry }[];
  failed: string[];
  /** True when a preflight/credit check stopped it. */
  blocked?: boolean;
}

/**
 * Decide, check, and create the folders. Fast — safe inside any request.
 *
 * Deliberately does NOT crawl. Call executeHarvest with the result.
 */
export async function planHarvest(
  now: Date = new Date(),
  opts: { force?: boolean } = {}
): Promise<HarvestPlan> {
  const schedule = await getSchedule();
  const { run, reason } = shouldRunNow(schedule, now);

  // `force` bypasses only the DAY GATE — never the preflight or the credit
  // check below, which exist to stop a run that cannot succeed from spending
  // anyway. It is a parameter rather than a temporary write to the schedule
  // because the obvious implementation (flip enabled, null out lastRunOn, run,
  // hope nothing throws before you put it back) leaves the client's schedule
  // permanently switched on when it does throw.
  if (!run && !opts.force) return { ran: false, reason, started: [], failed: [] };

  // Nobody is watching this run. An empty folder produced because OpenRouter is
  // out of credit looks exactly like an empty folder produced because there
  // were no leads — and the second is a lie. Check first, and if the run cannot
  // succeed, say so instead of spending Apify's budget to produce nothing.
  // Deliberately does NOT stamp lastRunOn: this week has not been used up, so
  // topping up the credit lets tomorrow's ping go ahead.
  const blocker =
    (await preflightBlocker()) ??
    (await creditBlockerFor(schedule.targetPerRun * Math.max(schedule.industries.length, 1)));
  if (blocker) {
    await recordHarvestHealth({ at: now.toISOString(), ok: false, reason: blocker });
    return { ran: false, reason: blocker, started: [], failed: [], blocked: true };
  }

  const supabase = createServiceRoleClient();

  // Stamp the run date BEFORE starting any work. Two drivers arriving close
  // together — a retry, the Vercel cron and a GitHub schedule on the same
  // morning — would otherwise both read "not run yet" and both start a paid
  // harvest. Claiming the day first makes the second one a no-op. The cost of
  // being wrong in this direction is a skipped week; in the other it is a
  // doubled bill.
  await saveSchedule({ ...schedule, lastRunOn: isoDay(now) });

  const started: HarvestPlan["started"] = [];
  const failed: string[] = [];

  // One search per vertical, so each lands as its own folder — the same shape a
  // manual search produces, which keeps every downstream view working with no
  // special case for scheduled runs.
  for (const industry of schedule.industries) {
    const label = weeklyLabel(industry, now);
    const query = `${label}, ${schedule.states.map(stateNameFor).join(", ")}`;

    const { data: search, error } = await supabase
      .from("searches")
      .insert({
        query,
        label,
        status: "running",
        mode: schedule.mode,
        target_signals: schedule.targetPerRun,
        revenue_min_musd: schedule.revenueMinMusd,
        revenue_max_musd: schedule.revenueMaxMusd,
        created_by: null, // no user, this run belongs to the schedule
      })
      .select("id, label")
      .single();

    if (error || !search) {
      failed.push(`${industry}: ${error?.message ?? "insert failed"}`);
      continue;
    }
    // The INDUSTRY travels with the row. `started` is only appended to on a
    // successful insert while schedule.industries is not, so indexing one by
    // the other's position desynchronised the moment any insert failed.
    started.push({ id: search.id, label: search.label, industry });
  }

  if (started.length === 0) {
    const why = `Could not create this month's folders: ${failed.join(" | ")}`;
    await recordHarvestHealth({ at: now.toISOString(), ok: false, reason: why });
    return { ran: false, reason: why, started: [], failed };
  }

  await recordHarvestHealth({
    at: now.toISOString(),
    ok: true,
    reason: `Started ${started.length} folder${started.length === 1 ? "" : "s"}.`,
    started: started.map((s) => s.label),
  });

  return { ran: true, reason, started, failed };
}

/**
 * Crawl the folders planHarvest created. SLOW — minutes per vertical.
 *
 * Sequential, not Promise.all. Two pipelines in parallel would double the
 * concurrent load on every vendor at once, which is the precise thing the
 * budget guards exist to prevent and the fastest way to burn a monthly quota in
 * a single night.
 */
export async function executeHarvest(plan: HarvestPlan): Promise<void> {
  if (!plan.ran || plan.started.length === 0) return;
  const schedule = await getSchedule();

  for (const run of plan.started) {
    try {
      await runSearchPipeline(
        run.id,
        run.industry,
        schedule.states,
        schedule.targetPerRun,
        schedule.mode,
        schedule.refinement,
        { min: schedule.revenueMinMusd, max: schedule.revenueMaxMusd }
      );
    } catch (e) {
      // runSearchPipeline already records failure on the row itself; this is
      // only so one vertical's blow-up cannot take the other down with it.
      console.error(`Monthly harvest failed for ${run.industry}:`, (e as Error).message);
    }
  }
}
