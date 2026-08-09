import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSchedule, saveSchedule } from "@/lib/pipeline/schedule";
import type { WeeklySchedule } from "@/lib/pipeline/schedule-types";
import { US_STATES } from "@/lib/pipeline/us-states";
import type { Industry, SearchMode } from "@/lib/supabase/types";

const VALID_STATES = new Set(US_STATES.map((s) => s.code));
const VALID_INDUSTRIES: Industry[] = ["landscaping", "home_builder"];
const VALID_MODES: SearchMode[] = ["signal", "filter", "hybrid"];

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  return NextResponse.json({
    schedule: await getSchedule(),
    // Whether the cron can actually reach us. Without this the toggle can read
    // "on" while nothing is wired up to call the endpoint — the worst possible
    // state, because it looks like it is working.
    cronConfigured: Boolean(process.env.CRON_SECRET),
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Partial<WeeklySchedule>;
  const current = await getSchedule();

  const states = Array.isArray(body.states)
    ? Array.from(new Set(body.states.map((s) => String(s).toUpperCase()))).filter((s) =>
        VALID_STATES.has(s)
      )
    : current.states;
  const industries = Array.isArray(body.industries)
    ? body.industries.filter((i): i is Industry => VALID_INDUSTRIES.includes(i as Industry))
    : current.industries;

  // Turning it ON with nothing to scan would create a schedule that fires and
  // silently does nothing every week. Refuse rather than store it.
  const enabled = typeof body.enabled === "boolean" ? body.enabled : current.enabled;
  if (enabled && (states.length === 0 || industries.length === 0)) {
    return NextResponse.json(
      { error: "Pick at least one vertical and one state before switching the weekly harvest on." },
      { status: 400 }
    );
  }

  const next: WeeklySchedule = {
    enabled,
    dayOfWeek:
      typeof body.dayOfWeek === "number" && body.dayOfWeek >= 0 && body.dayOfWeek <= 6
        ? Math.floor(body.dayOfWeek)
        : current.dayOfWeek,
    industries,
    states,
    targetPerRun:
      typeof body.targetPerRun === "number" && body.targetPerRun > 0
        ? Math.min(Math.floor(body.targetPerRun), 100)
        : current.targetPerRun,
    mode: VALID_MODES.includes(body.mode as SearchMode)
      ? (body.mode as SearchMode)
      : current.mode,
    // null is a MEANINGFUL value here ("no limit"), so `typeof === "number"`
    // rather than a truthiness check — and an absent key falls back to the
    // current setting rather than to null, so a partial save cannot silently
    // widen the band.
    revenueMinMusd:
      "revenueMinMusd" in body
        ? typeof body.revenueMinMusd === "number"
          ? body.revenueMinMusd
          : null
        : current.revenueMinMusd,
    revenueMaxMusd:
      "revenueMaxMusd" in body
        ? typeof body.revenueMaxMusd === "number"
          ? body.revenueMaxMusd
          : null
        : current.revenueMaxMusd,
    // Never writable from the UI — it is the cron's own bookkeeping, and
    // letting a save reset it would hand anyone an "ignore the 7-day
    // cooldown" button by accident.
    lastRunOn: current.lastRunOn,
  };

  await saveSchedule(next);
  return NextResponse.json({ schedule: next });
}
