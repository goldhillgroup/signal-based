import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { reapStaleRuns, reapStaleEnrichment } from "@/lib/pipeline/reap";

/**
 * Settle runs the platform killed, on demand.
 *
 * THE GAP THIS CLOSES. The progress dialog polls `fetchFolder`, which reads
 * Supabase DIRECTLY FROM THE BROWSER — no API route, so no server code runs on
 * a poll, so the reaper cannot fire while somebody is watching. Until now it
 * ran in exactly one place that matters: the dashboard layout render.
 *
 * The result, observed live: a run was killed by the 300-second function limit,
 * its row stayed `status: 'running'`, and the dialog sat on "still working" for
 * TEN MINUTES. Nothing was wrong with the data — 44 companies were saved and
 * complete — and nothing anywhere said so. The moment the dashboard was
 * rendered, the reaper marked it complete with an accurate message.
 *
 * So the fix is not more reaping, it is reaping where the WATCHER can reach it.
 * The dialog calls this once it has seen `running` for longer than a pass can
 * possibly last, which turns a silent hang into the honest "stopped at the time
 * limit, here is what it found, press Search to carry on".
 *
 * Cheap and idempotent: one indexed query on (status, created_at), and it only
 * touches rows already past the ceiling. Safe to call on every poll, though the
 * client waits for the ceiling to pass before bothering.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Authenticated only. This writes to search rows, and an open endpoint that
  // closes out runs is one anybody could use to interrupt a search.
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createServiceRoleClient();
  const [runs, enrichment] = await Promise.all([
    reapStaleRuns(service),
    reapStaleEnrichment(service),
  ]);

  return NextResponse.json({
    reapedRuns: runs.reaped,
    reapedEnrichment: enrichment.reaped,
  });
}
