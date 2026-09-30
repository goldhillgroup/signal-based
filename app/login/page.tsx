"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { canonicalEmail } from "@/lib/login-aliases";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SupabaseNotConfigured } from "@/components/SupabaseNotConfigured";
import { RadarIcon, ChevronDownIcon } from "@/components/icons";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // "Forgot password?" as a second mode of the same form, not a separate
  // page -- the email he already typed carries over, and there is nowhere
  // else this form needs to go.
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [resetStatus, setResetStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resetError, setResetError] = useState("");

  // DERIVED, not synced. This was an effect that called setError when the URL
  // carried ?error=auth — a value copied out of one source of truth into
  // another, which is the exact case React's own guidance says not to use an
  // effect for. Reading it during render also fixes a real bug: the effect
  // version could not be dismissed, because any setError("") was immediately
  // overwritten on the next render.
  const sessionExpired = params.get("error") === "auth";
  // Sent back here by app/auth/confirm/route.ts when a reset link was
  // expired, already used, or tampered with -- the honest failure case that
  // isn't a session timing out.
  const resetLinkFailed = params.get("error") === "reset";
  // TEMPORARY, alongside the matching temporary code in auth/confirm/route.ts
  // -- the real Supabase reason a reset link failed, so it's diagnosable
  // without Vercel log access. Strip both once answered.
  const resetDetail = params.get("detail");

  if (!isSupabaseConfigured) {
    return <SupabaseNotConfigured />;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();
    // A few other spellings of his own address log into this same account --
    // see lib/login-aliases.ts. Rewritten only for the call to Supabase; the
    // field keeps showing what was actually typed.
    const { error } = await supabase.auth.signInWithPassword({
      email: canonicalEmail(email),
      password,
    });
    setLoading(false);
    if (error) {
      setError("Invalid email or password.");
      return;
    }
    router.push("/dashboard/overview");
    router.refresh();
  }

  /**
   * REBUILT, not just re-added. The version that used to live here called
   * resetPasswordForEmail and never looked at the result, so it rendered
   * "Email sent" whether or not one was -- and Supabase's default mailer is
   * rate-limited and often silent, so the usual outcome was a confident tick
   * and no email. That cost people twenty minutes of checking spam before
   * they gave up and asked anyway, which is worse than no control at all.
   *
   * This one actually checks the error. On success it still says plainly
   * that the mailer can be slow -- that limitation is real and didn't go
   * away, only the pretending that it wasn't there did.
   *
   * THROUGH OUR OWN SERVER, not straight to Supabase. See
   * app/api/auth/forgot-password/route.ts -- same request, but a browser
   * behind a network that can reach this app and not a third-party auth
   * domain directly now still gets the email.
   *
   * RETRIES THE WHOLE REQUEST, up to 4 times, when the failure is the
   * "fetch failed" shape. Measured directly: this isn't a per-request coin
   * flip, it's a cold Vercel instance whose resolver is broken for that
   * instance's entire life -- one failing call took 4.7s (its own internal
   * retries all exhausted together) while every succeeding call landed
   * under 300ms on the first try. Retrying INSIDE one invocation therefore
   * barely helped (93% at 3 retries, 92% at 6); a fresh request has an
   * independent shot at a working instance, which is the only thing that
   * actually moves the number. A genuine rejection (bad email, real
   * infrastructure error) isn't retried -- it would just fail the same way
   * four times slower.
   */
  async function handleReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResetStatus("sending");
    setResetError("");

    let lastError = "Something went wrong. Try again in a moment.";
    for (let attempt = 0; attempt < 4; attempt++) {
      let res: Response;
      let j: { ok?: boolean; error?: string } = {};
      try {
        res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        j = await res.json().catch(() => ({}));
      } catch {
        lastError = "Something went wrong. Try again in a moment.";
        continue;
      }
      if (res.ok) {
        setResetStatus("sent");
        return;
      }
      lastError = j.error || lastError;
      if (!/fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(lastError)) break;
    }
    setResetStatus("error");
    setResetError(lastError);
  }

  function backToSignIn() {
    setMode("signin");
    setResetStatus("idle");
    setResetError("");
  }

  return (
    <div className="grid min-h-screen overflow-hidden bg-gh-page lg:grid-cols-2">
      {/* Left, form */}
      <div className="relative flex items-center justify-center bg-gh-surface px-8 py-12">
        <div className="w-full max-w-[360px]">
          <div className="mb-10 flex items-center gap-2.5">
            <Image src="/brand/goldhill-mark.png" alt="" width={30} height={30} className="rounded bg-gh-navy p-1" />
            <div className="leading-tight">
              <p className="font-display text-[13px] font-semibold tracking-wide text-gh-ink">
                GOLDHILL GROUP
              </p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-gh-ink-muted">
                Signal Radar
              </p>
            </div>
          </div>

          <h1 className="font-display text-2xl font-semibold text-gh-ink">
            {mode === "signin" ? "Welcome back" : "Reset your password"}
          </h1>
          <p className="mb-8 mt-1 text-sm text-gh-ink-secondary">
            {mode === "signin"
              ? "Sign in to your Signal Radar dashboard."
              : "We'll email a link to set a new one."}
          </p>

          {mode === "signin" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium text-gh-ink-secondary">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  // Generic on purpose. The real address was hardcoded here, which put the
                  // exact account to attack in front of every visitor to the login page
                  // and left it sitting in the client bundle. Email addresses are not
                  // secret, but naming the one valid account turns a password guess into
                  // a password attack.
                  placeholder="you@company.com"
                  className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:bg-gh-surface focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-gh-ink-secondary">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setMode("reset")}
                    className="cursor-pointer text-xs font-medium text-gh-ink-muted underline-offset-2 hover:text-gh-navy hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:bg-gh-surface focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
                />
              </div>

              {/* A submit error wins over either URL-driven notice: if he has
                  just tried and failed, that is the more useful sentence. */}
              {(error || sessionExpired || resetLinkFailed) && (
                <p className="text-xs font-medium text-gh-critical">
                  {error ||
                    (sessionExpired
                      ? "Your session expired. Please sign in again."
                      : "That reset link didn't work — it may have expired or already been used. Request a new one below.")}
                  {/* TEMPORARY, see the matching note by resetDetail above. */}
                  {resetDetail && <span className="mt-1 block break-all text-gh-ink-muted">{resetDetail}</span>}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full cursor-pointer rounded-lg bg-gh-navy py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-50"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="reset-email" className="text-sm font-medium text-gh-ink-secondary">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  disabled={resetStatus === "sending" || resetStatus === "sent"}
                  className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:bg-gh-surface focus:outline-none focus:ring-2 focus:ring-gh-sky/20 disabled:opacity-60"
                />
              </div>

              {resetStatus === "sent" ? (
                // HONEST, not a checkmark. The mailer really can be slow or
                // silent -- see handleReset -- so this says that plainly
                // rather than promising an email that might not arrive.
                <p className="rounded-lg bg-gh-surface-sunken px-3 py-2.5 text-xs leading-relaxed text-gh-ink-secondary">
                  If that address has an account, a reset link is on its way.
                  It can take a few minutes and sometimes lands in spam —
                  message Daniel if nothing shows up.
                </p>
              ) : (
                <button
                  type="submit"
                  disabled={resetStatus === "sending"}
                  className="w-full cursor-pointer rounded-lg bg-gh-navy py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-50"
                >
                  {resetStatus === "sending" ? "Sending…" : "Send reset link"}
                </button>
              )}

              {resetStatus === "error" && (
                <p className="text-xs font-medium text-gh-critical">{resetError}</p>
              )}

              <button
                type="button"
                onClick={backToSignIn}
                className="w-full cursor-pointer text-center text-xs font-medium text-gh-ink-muted hover:text-gh-navy"
              >
                Back to sign in
              </button>
            </form>
          )}

          <p className="mt-8 text-center text-[11px] text-gh-ink-muted">
            Invite-only. Accounts are created for you.
          </p>
        </div>
      </div>

      {/* Right, what the engine does */}
      <div className="relative hidden items-center justify-center overflow-hidden border-l border-gh-border bg-gh-navy px-16 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div
          className="pointer-events-none absolute -top-32 -right-32 h-[480px] w-[480px] rounded-full opacity-[0.12] blur-[100px]"
          style={{ background: "radial-gradient(circle, #0fa5e1 0%, transparent 60%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-24 h-[360px] w-[360px] rounded-full opacity-[0.10] blur-[90px]"
          style={{ background: "radial-gradient(circle, #fde428 0%, transparent 60%)" }}
        />

        <div className="relative flex w-full max-w-sm flex-col gap-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
            <RadarIcon className="h-5 w-5" />
          </span>
          {/* Deliberately short. The old panel ran a headline, a 40-word
              paragraph and a pull-quote at someone whose only goal here is to
              type a password. The funnel below says the same thing faster:
              each number is smaller than the last, which IS the product. */}
          <h2 className="font-display text-2xl font-semibold leading-snug text-white">
            Family businesses,
            <br />
            caught mid-handoff.
          </h2>

          {/* The shape of the work, as three steps rather than a paragraph. */}
          <div className="mt-1 flex items-stretch gap-2">
            {[
              { n: "57", l: "read", tone: "bg-white/5 text-white" },
              { n: "44", l: "cut, with reasons", tone: "bg-white/5 text-white" },
              { n: "13", l: "worth calling", tone: "bg-gh-sky/15 text-white" },
            ].map((s, i) => (
              <div key={s.l} className="flex flex-1 items-center gap-2">
                <div className={`flex-1 rounded-xl border border-white/10 p-3 ${s.tone}`}>
                  <p className="font-display text-2xl font-semibold leading-none">{s.n}</p>
                  <p className="mt-1 text-[11px] leading-tight text-white/50">{s.l}</p>
                </div>
                {i < 2 && (
                  <ChevronDownIcon
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 -rotate-90 text-white/25"
                  />
                )}
              </div>
            ))}
          </div>

          <p className="text-xs leading-relaxed text-white/45">
            A founder still in the seat, and a son or daughter already on the
            leadership page.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
