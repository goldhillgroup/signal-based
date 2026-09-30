import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the reset-password EMAIL LINK actually lands.
 *
 * WHY THIS EXISTS. resetPasswordForEmail (app/login/page.tsx) sends a link
 * carrying a one-time `code`, not a session -- Supabase's SSR client uses the
 * PKCE flow, so that code has to be exchanged for a real session before
 * anything downstream can call updateUser to set the new password. Without
 * this route the email would have nowhere correct to send him: landing
 * straight on /reset-password with an unexchanged code and no session would
 * just bounce him back to the login page.
 *
 * SERVER, NOT CLIENT. The exchange has to write the session into cookies
 * Next.js can read on the next request, which only a Route Handler (or
 * middleware) can do -- a client component setting client-side state would
 * not survive the redirect to /reset-password.
 *
 * `next` defaults to /reset-password because that's the only caller today,
 * but it's read from the query string rather than hardcoded so a future
 * magic-link or invite flow can reuse this same exchange without a copy of it.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/reset-password";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // TEMPORARY: the real reason, to find out whether this is the
    // redirect-URL allow-list or something else. Strip once answered --
    // a Supabase error string is not something to leave exposed on a
    // public redirect.
    return NextResponse.redirect(
      `${origin}/login?error=reset&detail=${encodeURIComponent(error.message)}`
    );
  }

  // No code at all. Distinguishing this from a rejected code matters for
  // diagnosis: Supabase's DEFAULT email template links to ITS OWN
  // /auth/v1/verify first and only then redirects here -- if the project is
  // still on the implicit flow, or the redirect_to got refused before ever
  // reaching this route, we'd see every OTHER query param except `code`.
  const allParams = Array.from(searchParams.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return NextResponse.redirect(
    `${origin}/login?error=reset&detail=${encodeURIComponent(`no code; received: ${allParams || "(nothing)"}`)}`
  );
}
