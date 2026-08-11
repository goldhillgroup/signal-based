"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/dashboard/overview"), 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gh-page px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <Image src="/brand/goldhill-mark.png" alt="" width={28} height={28} className="rounded bg-gh-navy p-1" />
          <span className="font-display text-sm font-semibold tracking-wide text-gh-ink">
            GOLDHILL GROUP
          </span>
        </div>

        <div className="mb-6 text-center">
          <h1 className="font-display text-2xl font-semibold text-gh-ink">
            Set new password
          </h1>
          <p className="mt-1 text-sm text-gh-ink-secondary">
            Choose a strong password for your account.
          </p>
        </div>

        {done ? (
          <div className="rounded-xl border px-5 py-4 text-center" style={{ borderColor: "#bfe3bf", background: "#e2f6e2" }}>
            <p className="text-sm font-semibold" style={{ color: "#0b7a0b" }}>
              Password updated!
            </p>
            <p className="mt-1 text-xs" style={{ color: "#0b7a0b" }}>
              Redirecting to dashboard…
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-gh-ink-secondary">
                New password
              </label>
              <input
                id="password"
                autoComplete="new-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:bg-gh-surface focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confirm" className="text-sm font-medium text-gh-ink-secondary">
                Confirm password
              </label>
              <input
                id="confirm"
                autoComplete="new-password"
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:bg-gh-surface focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
              />
            </div>
            {error && <p className="text-xs font-medium text-gh-critical">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gh-navy py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-50"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
