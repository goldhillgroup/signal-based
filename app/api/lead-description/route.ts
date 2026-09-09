import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSetting, setSetting } from "@/lib/settings";
import { DEFAULT_ICP } from "@/lib/pipeline/icp-types";

/**
 * What a good lead looks like, in Jonathan's own words.
 *
 * THIS IS THE WHOLE OF THE SCORING SETTING. It replaced five editable
 * sentences, one per rung, which was the third attempt at this card and still
 * too much machinery: "he gives a description, and based on the lead's info,
 * from his description it's a 1 2 3 4 or 5, nothing complex". The rungs are
 * fixed -- how completely a company matches what he wrote -- so the only thing
 * worth setting is what he wrote.
 *
 * IT IS NOT A LABEL, it is the input. This sentence becomes the default Signal
 * focus on every search, which is what the classifier judges each site against,
 * which is what has_signal means, which is what the 1-5 counts. Change it and
 * the next search scores differently -- otherwise it would be a caption on a
 * number it had no part in.
 */

export const KEY = "LEAD_DESCRIPTION";

/** Trimmed, capped, and never empty -- a blank would score everything alike. */
function clean(v: unknown): string {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 300) : "";
  return s || DEFAULT_ICP.signalFocus;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const saved = await resolveSetting(KEY, undefined);
  const description = clean(saved);
  return NextResponse.json({ description, isDefault: description === DEFAULT_ICP.signalFocus });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { description?: unknown; reset?: boolean };
  const description = body.reset ? DEFAULT_ICP.signalFocus : clean(body.description);
  await setSetting(KEY, description);
  return NextResponse.json({ description, isDefault: description === DEFAULT_ICP.signalFocus });
}
