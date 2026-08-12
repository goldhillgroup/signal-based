import { NextResponse } from "next/server";
import type { Industry } from "@/lib/supabase/types";
import { INDUSTRY_META } from "@/lib/signal-meta";
import { createClient } from "@/lib/supabase/server";
import { parseRequest, type SearchHistory } from "@/lib/pipeline/intake";

// Cheap: one Haiku call with a cached system prefix. Nothing is discovered,
// fetched or classified here — this only turns free text into parameters the
// user can confirm BEFORE any money is spent.
export const maxDuration = 30;

/** How far back to learn his habits from. Recent behaviour beats ancient. */
const HISTORY_LIMIT = 25;

export async function POST(req: Request) {
  // AUTH BEFORE VALIDATION, matching every other route. The paid call was
  // already safely behind this check, so nothing could be spent — but an
  // anonymous caller still got "Say what you're looking for", which confirms
  // the endpoint exists and names its parameter. Cheap to close, and it means
  // one rule holds everywhere instead of one route being the exception.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Say what you're looking for" }, { status: 400 });
  }

  // The adaptive half: his own past searches set the defaults, so a bare
  // "Oregon" inherits the industry and band he actually works in rather than
  // a hardcoded guess. Failure here is not fatal — cold-start defaults apply.
  let history: SearchHistory[] = [];
  const { data } = await supabase
    .from("searches")
    .select("query, label, mode, industries, revenue_min_musd, revenue_max_musd")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (data) {
    history = data.map((row) => ({
      // `searches.industries` is the real answer now; the label parse below is
      // the fallback for folders created before that column existed. It used to
      // be the ONLY path and recognised two verticals, so a run in any of the
      // six added later contributed nothing to the defaults heuristic.
      industry:
        (row.industries?.[0] as Industry | undefined) ??
        (Object.keys(INDUSTRY_META) as Industry[]).find((key) =>
          new RegExp(INDUSTRY_META[key].label.replace(/\s+/g, "\\s*"), "i").test(row.label ?? "")
        ) ??
        null,
      state: null,
      mode: row.mode ?? null,
      revenue_min_musd: row.revenue_min_musd,
      revenue_max_musd: row.revenue_max_musd,
    }));
  }

  const result = await parseRequest(text, history);
  return NextResponse.json(result);
}
