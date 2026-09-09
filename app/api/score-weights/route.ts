import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSetting, setSetting } from "@/lib/settings";
import { DEFAULT_WEIGHTS, parseWeights } from "@/lib/score-weights";

/**
 * What a lead is scored on, and how much each thing counts.
 *
 * Its own route rather than the vendor-keys one, because that route treats
 * every value as a secret string from a fixed list of key names. This is a
 * JSON object the client both reads and writes, and it is not a secret.
 *
 * Stored in app_settings, which already exists -- so no migration, which
 * matters here because there is no way to run one from this app.
 */

const KEY = "SCORE_WEIGHTS";

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
    // A hand-edited row that no longer parses falls back rather than breaking
    // every score in the app.
    parsed = null;
  }
  // COMPARED, not inferred from whether a row exists. Reset writes the
  // defaults rather than deleting the row, so "is there a row" answered no
  // forever after and the reset button never went quiet.
  const weights = parseWeights(parsed);
  const isDefault = (Object.keys(DEFAULT_WEIGHTS) as (keyof typeof DEFAULT_WEIGHTS)[]).every(
    (k) => weights[k] === DEFAULT_WEIGHTS[k]
  );
  return NextResponse.json({ weights, isDefault, defaults: DEFAULT_WEIGHTS });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { weights?: unknown; reset?: boolean };
  if (body.reset) {
    await setSetting(KEY, JSON.stringify(DEFAULT_WEIGHTS));
    return NextResponse.json({ weights: DEFAULT_WEIGHTS, isDefault: true });
  }
  // parseWeights clamps to 0-100 and fills anything missing, so a malformed
  // body cannot produce a scoring model where every lead is zero.
  const weights = parseWeights(body.weights);
  await setSetting(KEY, JSON.stringify(weights));
  const isDefault = (Object.keys(DEFAULT_WEIGHTS) as (keyof typeof DEFAULT_WEIGHTS)[]).every(
    (k) => weights[k] === DEFAULT_WEIGHTS[k]
  );
  return NextResponse.json({ weights, isDefault });
}
