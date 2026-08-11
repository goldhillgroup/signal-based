import { NextResponse } from "next/server";
import { after } from "next/server";
import { getSchedule } from "@/lib/pipeline/schedule";
import { shouldRunNow, isoDay, weeklyLabel } from "@/lib/pipeline/schedule-types";
import { planHarvest, executeHarvest } from "@/lib/pipeline/harvest";

// See app/api/search/route.ts for why 800 and what it requires.
//
// THIS ROUTE IS NO LONGER THE ONLY WAY TO RUN THE HARVEST, and on a plan that
// caps below 800s it is not the best one. The identical work runs in
// .github/workflows/weekly-harvest.yml with no ceiling at all — see
// lib/pipeline/harvest.ts. Keeping both is deliberate: planHarvest claims the
// day before any crawling starts, so whichever driver arrives first wins and
// the other is a no-op. Two chances to catch the week, one harvest.
export const maxDuration = 800;

/**
 * The weekly harvest, driven by a cron ping.
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

  // ?dry=1 — report the decision and the folders that WOULD be created, then
  // change nothing: no rows written, no lastRunOn stamped, no pipeline run, no
  // money spent. This is how you confirm the cron is actually wired up after a
  // deploy. The alternative is triggering a real paid harvest to find out
  // whether the URL and secret are right, which is a bad way to learn it.
  if (new URL(req.url).searchParams.get("dry") === "1") {
    const schedule = await getSchedule();
    const { run, reason } = shouldRunNow(schedule, now);
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

  const plan = await planHarvest(now);

  // A skip is a 200, not an error. Six of every seven pings are skips by
  // design, and a cron platform that sees a non-2xx will start emailing about
  // a system that is working exactly as intended. A failure to CREATE the
  // folders is different, and does deserve a 500.
  if (!plan.ran) {
    const status = plan.failed.length > 0 && !plan.blocked ? 500 : 200;
    return NextResponse.json(
      { ran: false, reason: plan.reason, blocked: plan.blocked, failed: plan.failed },
      { status }
    );
  }

  // Runs after this response is sent, inside the function's remaining lifetime.
  // This is the half that the platform ceiling can cut short; the GitHub
  // Actions driver awaits the same call with no ceiling at all.
  after(() => executeHarvest(plan));

  return NextResponse.json({
    ran: true,
    reason: plan.reason,
    started: plan.started.map((s) => ({ id: s.id, label: s.label })),
    failed: plan.failed,
  });
}
