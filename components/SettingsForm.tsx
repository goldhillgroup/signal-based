"use client";

import { useState } from "react";

type Row = {
  key: string;
  label: string;
  status: "db" | "env" | "unset";
  masked: string | null;
};

const STATUS_META: Record<Row["status"], { label: string; color: string; bg: string }> = {
  db: { label: "Set in Settings", color: "#0b7a0b", bg: "#e2f6e2" },
  env: { label: "Using .env fallback", color: "#0b5e85", bg: "#e2f3fb" },
  unset: { label: "Not configured", color: "#a3272a", bg: "#fbdcdc" },
};

export function SettingsForm({ rows: initialRows }: { rows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  async function save(key: string) {
    const value = (drafts[key] ?? "").trim();
    if (!value) return;
    setSaving(key);
    setFeedback((f) => ({ ...f, [key]: "" }));
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to save");
      }
      // Re-mask locally from the just-saved value — never re-fetch or
      // display the raw value back, even the one just typed.
      const masked = value.length <= 4 ? "••••" : `••••••••${value.slice(-4)}`;
      setRows((prev) =>
        prev.map((r) => (r.key === key ? { ...r, status: "db", masked } : r))
      );
      setDrafts((d) => ({ ...d, [key]: "" }));
      setFeedback((f) => ({ ...f, [key]: "Saved — takes effect on the next search." }));
    } catch (e) {
      setFeedback((f) => ({ ...f, [key]: (e as Error).message }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const meta = STATUS_META[row.status];
        return (
          <div
            key={row.key}
            className="rounded-xl border border-gh-border bg-gh-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gh-ink">{row.label}</p>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ color: meta.color, background: meta.bg }}
              >
                {meta.label}
              </span>
            </div>
            {row.masked && (
              <p className="mt-1 font-mono text-xs text-gh-ink-muted">{row.masked}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="password"
                autoComplete="off"
                value={drafts[row.key] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                placeholder="Enter a new value to change"
                className="min-w-[240px] flex-1 rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
              />
              <button
                type="button"
                onClick={() => save(row.key)}
                disabled={saving === row.key || !(drafts[row.key] ?? "").trim()}
                className="rounded-lg bg-gh-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving === row.key ? "Saving…" : "Save"}
              </button>
            </div>
            {feedback[row.key] && (
              <p
                className={`mt-1.5 text-xs font-medium ${
                  feedback[row.key].startsWith("Saved") ? "text-gh-ink-secondary" : "text-gh-critical"
                }`}
              >
                {feedback[row.key]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
