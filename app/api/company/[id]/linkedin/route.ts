import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { lookupOnLinkedIn } from "@/lib/pipeline/linkedin";
import { runWithCounters, estimateUsd, type CostCounters } from "@/lib/pipeline/cost-tracker";

/**
 * Look this company up on LinkedIn.
 *
 * Jonathan's ask: company size, titles, and anything else LinkedIn knows,
 * without him doing it by hand. See lib/pipeline/linkedin.ts for how it reads
 * the public pages through a search index rather than fetching linkedin.com,
 * which their terms forbid and which they block anyway.
 *
 * ON DEMAND, not part of a search. Two searches per company at roughly 1.6
 * cents, and it finds something on about half of them, so running it across
 * every lead in the database would spend money on a coin flip. Pressing it on
 * a lead he is actually looking at is where the value is.
 *
 * WRITES ONLY employee_band, and only when it is currently empty. Titles come
 * back too, but they are shown rather than saved: LinkedIn writes what a
 * person put on their own profile, the company's site writes what the company
 * says, and quietly overwriting the second with the first would edit the
 * evidence. He can correct a title in the people editor if he wants to.
 */

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createServiceRoleClient();
  const { data: company } = await service
    .from("companies")
    .select("id, name, employee_band, founder_name, next_gen_name")
    .eq("id", id)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: "No such company." }, { status: 404 });

  const counters: CostCounters = { counts: {} };
  const find = await runWithCounters(counters, () =>
    lookupOnLinkedIn({
      name: company.name,
      knownNames: [company.founder_name, company.next_gen_name],
    })
  );

  let wroteSize = false;
  if (find.employeeBand && !company.employee_band) {
    const { error } = await service
      .from("companies")
      .update({ employee_band: find.employeeBand })
      .eq("id", id);
    if (!error) wroteSize = true;
  }

  return NextResponse.json({
    ok: true,
    employeeBand: find.employeeBand,
    wroteSize,
    companyUrl: find.companyUrl,
    people: find.people,
    checked: find.checked,
    costUsd: Number(estimateUsd(counters).toFixed(4)),
  });
}
