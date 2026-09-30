import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Change the SIGNED-IN account's own email.
 *
 * SAME AUTH PATTERN as every other route here (see app/api/settings/route.ts):
 * createClient() is cookie-bound to the request, getUser() proves there's a
 * real session, and only then does anything happen. This is not a special
 * case -- there is no admin/service-role path here at all. Supabase's own
 * updateUser() runs as that signed-in user, on their own account, the same
 * way it would from any other authenticated client. Nothing here can touch
 * an account nobody is currently logged into.
 *
 * GET returns the current email, so the Settings card has something to show
 * before anyone types into it.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ email: user.email });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? "").trim();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const { data, error } = await supabase.auth.updateUser({ email });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Supabase may require confirming the NEW address before the change takes
  // effect (project-dependent -- "Secure email change" setting). Either way
  // is true here: say what actually happened rather than assuming.
  const pending = data.user?.email !== email;
  return NextResponse.json({ ok: true, pending, email: data.user?.email ?? email });
}
