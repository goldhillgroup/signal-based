import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSetting, setSetting } from "@/lib/settings";
import { DEFAULT_RULES, parseRules, type ScoreRules } from "@/lib/lead-score";

/**
 * What each rung of the 1-5 is worth.
 *
 * Five numbers in app_settings. Not the twelve-weight machine that was built
 * and cut: the rules themselves are fixed, because they are the qualification
 * the pipeline already applies, and only the number each situation lands on
 * moves.
 */

const KEY = "SCORE_RULES";

function isDefault(r: ScoreRules) {
  return (Object.keys(DEFAULT_RULES) as (keyof typeof DEFAULT_RULES)[]).every(
    (k) => r[k] === DEFAULT_RULES[k]
  );
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = await resolveSetting(KEY, undefined);
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // A row that no longer parses falls back rather than scoring every lead 0.
    parsed = null;
  }
  const rules = parseRules(parsed);
  return NextResponse.json({ rules, isDefault: isDefault(rules) });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { rules?: unknown; reset?: boolean };
  const rules = body.reset ? DEFAULT_RULES : parseRules(body.rules);
  await setSetting(KEY, JSON.stringify(rules));
  return NextResponse.json({ rules, isDefault: isDefault(rules) });
}
