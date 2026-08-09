"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    if (params.get("error") === "auth") {
      setError("Your session expired. Please sign in again.");
    }
  }, [params]);

  if (!isSupabaseConfigured) {
    return <SupabaseNotConfigured />;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("Invalid email or password.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function handleForgotPassword() {
    if (!email) {
      setError("Enter your email above first.");
      return;
    }
    setResetLoading(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    setResetLoading(false);
    setResetSent(true);
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

          <h1 className="font-display text-2xl font-semibold text-gh-ink">Welcome back</h1>
          <p className="mb-8 mt-1 text-sm text-gh-ink-secondary">
            Sign in to your Signal Radar dashboard.
          </p>

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
                placeholder="jonathan@thegoldhillgroup.com"
                className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:bg-gh-surface focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-gh-ink-secondary">
                  Password
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                  className="text-xs font-medium text-gh-ink-muted transition-colors hover:text-gh-sky disabled:opacity-50"
                >
                  {resetLoading ? "Sending…" : resetSent ? "Email sent ✓" : "Forgot password?"}
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

            {error && <p className="text-xs font-medium text-gh-critical">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-lg bg-gh-navy py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-50"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-8 text-center text-[11px] text-gh-ink-muted">
            Invite-only, reach out to your Deep Loom contact for access.
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
