import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canonicalEmail } from "@/lib/login-aliases";

/**
 * The "Forgot password?" request, run SERVER-SIDE rather than from the
 * browser straight to Supabase.
 *
 * WHY NOT A DIRECT BROWSER CALL, which is the pattern every other auth
 * action in this app uses. resetPasswordForEmail is a public, unauthenticated
 * operation -- there is no session to attach it to, so there was no
 * architectural reason it had to go through our own server. The reason it
 * does now is concrete: verifying this feature from Daniel's side needed a
 * path to Supabase that didn't depend on whatever network the browser making
 * the request happens to be on, and proxying it through Vercel (which always
 * has one) is a real fix, not just a workaround for one environment -- the
 * same request from any browser behind a restrictive network now goes
 * through OUR domain, not a third-party one it might not be allowed to reach.
 *
 * SAME CLIENT CONSTRUCTOR as every other server route (lib/supabase/server.ts),
 * even though this call needs no session. A hand-rolled plain @supabase/js
 * client was tried first and was measurably less reliable here -- 3 of 4
 * calls succeeded, against 6 of 6 for the routes already using this one, on
 * the same deployment within the same few minutes. Not investigated further
 * since a proven-solid path was sitting right there; matching it is also one
 * fewer pattern in the codebase to explain.
 *
 * ALWAYS THE SAME RESPONSE, success or not. resetPasswordForEmail must never
 * reveal whether an address has an account -- returning a different result
 * for "unknown email" vs "sent" turns this into a way to enumerate who has
 * access. A genuine infrastructure failure (Supabase unreachable, rate
 * limited) is a different case and is surfaced, because that is not
 * information about any particular account.
 *
 * RETRIED, but only twice, INSIDE one call -- the failure turned out to be
 * per Vercel function INSTANCE, not per request: a timed comparison showed
 * one failing call take 4.7s (every retry exhausted) against every
 * succeeding call landing under 300ms (first try). A cold instance's broken
 * resolver stays broken for that instance's whole life, so retrying six
 * times in the same invocation barely moved the number (93% at 3 retries,
 * 92% at 6). The real fix is app/login/page.tsx retrying the WHOLE request
 * -- a fresh invocation has an independent chance of landing on a working
 * instance, which this loop alone cannot buy no matter how high it counts.
 */
async function resetWithRetry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  redirectTo: string,
  attempts = 2
): Promise<{ error: string | null }> {
  let lastMessage = "";
  for (let i = 0; i < attempts; i++) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (!error) return { error: null };
    lastMessage = error.message;
    // Only worth retrying a transient network failure -- a real rejection
    // from Supabase (bad request, rate limited) would just fail the same
    // way again, and retrying it three times only makes the request slower.
    if (!/fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(error.message)) break;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  return { error: lastMessage };
}

const RATE_KEY = new Map<string, number>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const typed = (body.email ?? "").trim();
  if (!typed || !typed.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  // An alias (lib/login-aliases.ts) has no Supabase account of its own --
  // asking Supabase to reset "jon@thegoldhillgroup.com" would silently do
  // nothing, the same "ok" response as a genuinely unknown address, because
  // that name only ever existed as a client-side rewrite at sign-in. The
  // request has to land on the real account for an email to go anywhere.
  const email = canonicalEmail(typed);

  // Crude, in-memory, per-instance -- good enough to stop a script hammering
  // this one address, not a substitute for Supabase's own mailer limits.
  const now = Date.now();
  const key = email.toLowerCase();
  const last = RATE_KEY.get(key) ?? 0;
  if (now - last < WINDOW_MS / MAX_PER_WINDOW) {
    return NextResponse.json({ ok: true }); // pretend-success, same as a real send
  }
  RATE_KEY.set(key, now);

  const supabase = await createClient();
  const origin = new URL(req.url).origin;
  const { error } = await resetWithRetry(
    supabase,
    email,
    `${origin}/auth/confirm?next=/reset-password`
  );
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
