"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SupabaseNotConfigured } from "@/components/SupabaseNotConfigured";

/**
 * Set a new password, arrived at from the email link.
 *
 * WHY A SESSION CHECK BEFORE THE FORM. app/auth/confirm/route.ts only
 * reaches here after successfully exchanging the emailed code for a session
 * -- but this page can also be opened directly (a bookmark, a stale tab, a
 * link forwarded without its code) with no such session behind it. Rendering
 * the form anyway would let updateUser fail with a Supabase error that means
 * nothing to him ("Auth session missing"); checking first and saying "get a
 * new link" in plain words is the honest version of the same fact.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let off = false;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!off) {
          setHasSession(!!data.session);
          setChecking(false);
        }
      });
    return () => {
      off = true;
    };
  }, []);

  if (!isSupabaseConfigured) {
    return <SupabaseNotConfigured />;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    // Caught here rather than left to Supabase's own message, which talks
    // about password requirements, not about the two fields disagreeing.
    if (password !== confirm) {
      setError("Those two don't match.");
      return;
    }
    if (password.length < 8) {
      setError("At least 8 characters.");
      return;
    }
    setSaving(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
    // A couple of seconds to actually read the confirmation before it
    // whisks him away, rather than an instant redirect that reads as
    // nothing having happened.
    setTimeout(() => {
      router.push("/dashboard/overview");
      router.refresh();
    }, 1800);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gh-page px-6">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 flex items-center gap-2.5">
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

        {checking ? (
          <p className="text-sm text-gh-ink-secondary">Checking your link…</p>
        ) : !hasSession ? (
          <div className="space-y-3">
            <h1 className="font-display text-xl font-semibold text-gh-ink">
              This link isn&rsquo;t valid
            </h1>
            <p className="text-sm leading-relaxed text-gh-ink-secondary">
              It may have expired, already been used, or been opened without
              the original email. Go back and request a new one.
            </p>
            <a
              href="/login"
              className="inline-block rounded-lg bg-gh-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2"
            >
              Back to sign in
            </a>
          </div>
        ) : done ? (
          <div className="space-y-2">
            <h1 className="font-display text-xl font-semibold text-gh-ink">Password updated</h1>
            <p className="text-sm text-gh-ink-secondary">Taking you to your dashboard…</p>
          </div>
        ) : (
          <>
            <h1 className="font-display text-xl font-semibold text-gh-ink">Set a new password</h1>
            <p className="mb-6 mt-1 text-sm text-gh-ink-secondary">
              At least 8 characters. This replaces the old one everywhere.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="new-password" className="text-sm font-medium text-gh-ink-secondary">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  autoFocus
                  className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink focus:border-gh-sky focus:bg-gh-surface focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="confirm-password" className="text-sm font-medium text-gh-ink-secondary">
                  Confirm it
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink focus:border-gh-sky focus:bg-gh-surface focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
                />
              </div>
              {error && <p className="text-xs font-medium text-gh-critical">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full cursor-pointer rounded-lg bg-gh-navy py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Set password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
