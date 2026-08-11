import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getIcp, setIcp } from "@/lib/pipeline/icp";
import { normalizeIcp } from "@/lib/pipeline/icp-types";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  return NextResponse.json({ icp: await getIcp() });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  // normalizeIcp is the single place that decides what a valid profile is, so
  // the form, the stored row and this endpoint cannot drift apart.
  const icp = await setIcp(normalizeIcp(body));
  return NextResponse.json({ icp });
}
