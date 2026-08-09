import { NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { runSearchPipeline } from "@/lib/pipeline/orchestrator";
import { getSchedule, saveSchedule } from "@/lib/pipeline/schedule";
import { shouldRunNow, isoDay, weeklyLabel } from "@/lib/pipeline/schedule-types";
import { preflightBlocker, creditBlockerFor, recordHarvestHealth } from "@/lib/pipeline/preflight";
import { stateNameFor } from "@/lib/pipeline/us-states";

// Same ceiling as the interactive route — this runs the identical pipeline.
// See app/api/search/route.ts for why 800 and what it requires.
export const maxDuration = 800;

/**
 * The weekly harvest.
 *
 * Ping this DAILY (Vercel Cron, GitHub Actions, or any uptime pinger). The
 * endpoint decides whether today is a run day — see shouldRunNow(). A daily
 * ping with a 7-day cooldown self-heals a missed window, where a weekly cron
 * expression silently loses a whole week to one bad deploy.
 *
 * Auth: a shared secret, not a user session. Cron has no cookies. Without
 * CRON_SECRET set the endpoint refuses to run at all rather than defaulting
 * open — an unauthenticated endpoint that spends money on every GET is the
 * one failure mode that must not be reachable by accident.
 *
 * GET is used because that is what most cron platforms send by default.
 * Nothing here is a browser navigation, and the secret never appears in a
 * URL — it comes in the Authorization header.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured, the weekly harvest is disabled." },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const now = new Date();
  const schedule = await getSchedule();
  const { run, reason } = shouldRunNow(schedule, now);

  // ?dry=1 — report the decision and the folders that WOULD be created, then
  // change nothing: no rows written, no lastRunOn stamped, no pipeline run, no
  // money spent. This is how you confirm the cron is actually wired up after a
  // deploy. The alternative is triggering a real paid harvest to find out
  // whether the URL and secret are right, which is a bad way to learn it.
  if (new URL(req.url).searchParams.get("dry") === "1") {
    return NextResponse.json({
      dryRun: true,
      wouldRun: run,
      reason,
      today: isoDay(now),
      schedule,
      wouldCreate: run
        ? schedule.industries.map((i) => ({
            label: weeklyLabel(i, now),
            states: schedule.states,
            target: schedule.targetPerRun,
          }))
        : [],
    });
  }

  // A skip is a 200, not an error. Six of every seven pings are skips by
  // design, and a cron platform that sees a non-2xx will start emailing about
  // a system that is working exactly as intended.
  if (!run) {
    return NextResponse.json({ ran: false, reason });
  }

  // ── Pre-flight ───────────────────────────────────────────────────────
  // Nobody is watching this run. An empty folder produced because OpenRouter
  // is out of credit looks exactly like an empty folder produced because there
  // were no leads — and the second is a lie. Check first, and if the run
  // cannot succeed, say so instead of spending Apify's budget to produce
  // nothing. Deliberately does NOT stamp lastRunOn: this week has not been
  // used up, so topping up the credit lets tomorrow's ping go ahead.
  // Sized for the WHOLE harvest: one run per vertical, so the floor scales
  // with how many folders this ping is about to start.
  const blocker =
    (await preflightBlocker()) ??
    (await creditBlockerFor(schedule.targetPerRun * Math.max(schedule.industries.length, 1)));
  if (blocker) {
    await recordHarvestHealth({ at: now.toISOString(), ok: false, reason: blocker });
    return NextResponse.json({ ran: false, reason: blocker, blocked: true });
  }

  const supabase = createServiceRoleClient();

  // Stamp the run date BEFORE starting any work. Two pings arriving close
  // together — a retry, an overlapping platform schedule — would otherwise
  // both read "not run yet" and both start a paid harvest. Claiming the day
  // first makes the second ping a no-op. The cost of being wrong in this
  // direction is a skipped week; in the other it is a doubled bill.
  await saveSchedule({ ...schedule, lastRunOn: isoDay(now) });

  const started: { id: string; label: string }[] = [];
  const failed: string[] = [];

  // One search per vertical, so each lands as its own folder — the same shape
  // a manual search produces, which keeps every downstream view (folders, day
  // grouping, enrichment) working with no special case for scheduled runs.
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
        // The REAL band, not null. runSearchPipeline below is already passed
        // schedule.revenueMinMusd/MaxMusd, so hardcoding null here recorded the
        // run as unbounded while it ran bounded — which makes a correctly
        // applied band look like it was never set when anyone checks later.
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
    started.push({ id: search.id, label: search.label });
  }

  if (started.length === 0) {
    const why = `Could not create this week's folders: ${failed.join(" | ")}`;
    await recordHarvestHealth({ at: now.toISOString(), ok: false, reason: why });
    return NextResponse.json({ ran: false, reason: why, failed }, { status: 500 });
  }

  await recordHarvestHealth({
    at: now.toISOString(),
    ok: true,
    reason: `Started ${started.length} folder${started.length === 1 ? "" : "s"}.`,
    started: started.map((s) => s.label),
  });

  // Sequential, not Promise.all. Two pipelines in parallel would double the
  // concurrent load on every vendor at once — which is the precise thing the
  // budget guards exist to prevent, and the fastest way to burn a monthly
  // quota in a single night.
  after(async () => {
    for (let i = 0; i < started.length; i++) {
      const industry = schedule.industries[i];
      try {
        await runSearchPipeline(
          started[i].id,
          industry,
          schedule.states,
          schedule.targetPerRun,
          schedule.mode,
          // Was hardcoded null, so even once the field existed the scheduled
          // run would have ignored it.
          schedule.refinement,
          // Was hardcoded { min: null, max: null }, so every scheduled scan ran
          // unbounded while the manual form defaulted to $3-15M — the same
          // request returning different companies depending on which screen
          // asked for it.
          { min: schedule.revenueMinMusd, max: schedule.revenueMaxMusd }
        );
      } catch (e) {
        // runSearchPipeline already records failure on the row itself; this is
        // only so one vertical's blow-up cannot take the other down with it.
        console.error(`Weekly harvest failed for ${industry}:`, (e as Error).message);
      }
    }
  });

  return NextResponse.json({ ran: true, reason, started, failed });
}
