"use client";

import { useEffect, useState } from "react";

/**
 * Change the email you log in with.
 *
 * Runs through app/api/account/route.ts, which acts as YOU -- it's gated on
 * your own signed-in session, the same as everything else in Settings. There
 * is no separate admin path; if you're not logged in, this can't do anything.
 */
export function AccountEmail() {
  const [current, setCurrent] = useState<string | null>(null);
  const [next, setNext] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "good" | "error" } | null>(null);

  useEffect(() => {
    let off = false;
    fetch("/api/account")
      .then((r) => r.json())
      .then((j) => {
        if (off) return;
        if (typeof j?.email === "string") {
          setCurrent(j.email);
          setNext(j.email);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      off = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: next }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMessage({ text: j.error || "Something went wrong.", tone: "error" });
        return;
      }
      if (j.pending) {
        setMessage({
          text: `Almost done — confirm it from the link sent to ${next} before it takes effect.`,
          tone: "good",
        });
      } else {
        setCurrent(j.email);
        setMessage({ text: "Updated. Sign in with this address from now on.", tone: "good" });
      }
    } finally {
      setSaving(false);
    }
  }

  const dirty = loaded && next.trim().toLowerCase() !== (current ?? "").toLowerCase();

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-gh-ink">Your login email</h2>
      <p className="mt-0.5 mb-3 text-sm text-gh-ink-secondary">
        What you sign in with. The password stays the same.
      </p>
      <div className="rounded-xl border border-gh-border bg-gh-surface p-4">
        <label
          htmlFor="account-email"
          className="text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted"
        >
          Email
        </label>
        <input
          id="account-email"
          type="email"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={!loaded || saving}
          className="mt-1.5 w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2 text-sm text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:opacity-50"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={save}
            className="cursor-pointer rounded-lg bg-gh-navy px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {dirty && !saving && (
            <button
              type="button"
              onClick={() => setNext(current ?? "")}
              className="cursor-pointer text-xs font-medium text-gh-ink-secondary hover:text-gh-ink"
            >
              Cancel
            </button>
          )}
        </div>
        {message && (
          <p className={`mt-2 text-xs ${message.tone === "good" ? "text-gh-good" : "text-gh-critical"}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
