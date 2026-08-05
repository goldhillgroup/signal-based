"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SupabaseNotConfigured } from "@/components/SupabaseNotConfigured";
import { RadarIcon } from "@/components/icons";

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
      {/* Left — form */}
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
            Invite-only — reach out to your Deep Loom contact for access.
          </p>
        </div>
      </div>

      {/* Right — what the engine does */}
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
          <h2 className="font-display text-xl font-semibold leading-snug text-white">
            Family businesses at the handoff moment — found before they raise
            their hand.
          </h2>
          <p className="text-sm leading-relaxed text-white/60">
            Watches landscaping companies and home builders for the same signal
            fifteen years of Jonathan&rsquo;s pattern recognition looks for: a
            founder still in the seat, a next-gen name stepping onto the
            leadership page.
          </p>

          <div className="mt-2 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="font-display text-2xl font-semibold text-white">13</p>
              <p className="mt-0.5 text-xs text-white/50">Qualified companies, proof run</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="font-display text-2xl font-semibold text-white">44</p>
              <p className="mt-0.5 text-xs text-white/50">Reviewed and explicitly cut</p>
            </div>
          </div>

          <p className="text-xs italic leading-relaxed text-white/40">
            &ldquo;Nothing is deleted, only labeled — every rejected company stays
            visible with its reason.&rdquo;
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
