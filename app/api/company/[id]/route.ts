import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Blacklist a company, or put it back.
 *
 * WHY THIS EXISTS. There was no way to act on a lead you had looked at and did
 * not want. Jonathan's Florida list carries "Father & Son Landscaping" twice,
 * and a duplicate is the mildest case: the others are a company he already
 * works with, a competitor, a client he has just left, or a row he can see is
 * wrong. His only tool was deleting the whole folder.
 *
 * BLACKLISTED, NOT REMOVED, and the difference is the whole point. Taking a
 * row off one list leaves the company in play, so the next search over the
 * same trade and state rediscovers it, re-fetches it, re-classifies it at
 * about 3 cents, and puts it back in front of him -- having already been told
 * he does not want it. Judgement he has spent time on has to survive.
 *
 * The mechanism already existed and is the same one the crawler uses for
 * settled companies: recheck_after NULL means never reconsider, and discovery
 * builds its skip set from exactly that (orchestrator.ts, "recheck_after.is
 * .null,recheck_after.gt.now"). So a blacklisted company is invisible to every
 * future search, not merely to this list.
 *
 * NOT A DELETE. The row stays, marked, in Not a fit, where it can be put back.
 * "The reason is sometimes wrong" is the argument the whole cut pile rests on,
 * and it would be strange to apply that to the model's judgements and not to
 * the user's own.
 */

export const BLACKLIST_REASON = "Blacklisted by you";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action;
  if (action !== "blacklist" && action !== "restore") {
    return NextResponse.json({ error: "Blacklist or restore?" }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data: company } = await service
    .from("companies")
    .select("id, domain, status, rejection_reason")
    .eq("id", id)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: "No such company." }, { status: 404 });

  if (action === "blacklist") {
    // EVERY ROW ON THIS DOMAIN, not just this one. A company found by two
    // searches has two rows, and blacklisting the one he happened to be
    // looking at would leave the other live and the company still arriving.
    const { data: rows, error } = await service
      .from("companies")
      .update({
        status: "rejected",
        rejection_reason: BLACKLIST_REASON,
        // NULL is "never reconsider". This is the line that makes it a
        // blacklist rather than a tidy-up.
        recheck_after: null,
      })
      .eq("domain", company.domain)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, blacklisted: (rows ?? []).length, domain: company.domain });
  }

  // RESTORE WORKS ON ANY REJECTED ROW, not only the blacklisted ones. The
  // product's argument for showing the cut pile is that the reason is
  // sometimes wrong; refusing to act on that would make the tab a display case
  // rather than a control.
  //
  // recheck_after goes back to "due now" rather than staying null, so a
  // company put back is a company the crawler is willing to look at again.
  const { data: rows, error } = await service
    .from("companies")
    .update({
      status: "qualified",
      rejection_reason: null,
      recheck_after: new Date().toISOString(),
    })
    .eq("domain", company.domain)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, restored: (rows ?? []).length, domain: company.domain });
}
