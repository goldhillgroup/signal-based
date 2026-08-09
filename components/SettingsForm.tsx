"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import type { VendorUsage, WarnLevel } from "@/lib/vendor-usage";
import { ChevronDownIcon } from "./icons";

type Row = {
  key: string;
  label: string;
  status: "db" | "env" | "unset";
  masked: string | null;
  /** What this key is for, in one sentence. See SETTINGS_KEYS. */
  what: string;
  logo: string | null;
  link: string | null;
  linkLabel?: string;
  advanced?: boolean;
  usageId?: string;
};

// Matches lib/vendor-usage.ts. "ok" stays deliberately quiet: a healthy vendor
// should not compete for attention with a spent one two cards down.
const LEVEL: Record<WarnLevel, { pill: string; bar: string; label: string }> = {
  ok: { pill: "bg-gh-surface-sunken text-gh-ink-secondary", bar: "var(--gh-sky)", label: "ok" },
  near: { pill: "bg-gh-warning/25 text-gh-ink", bar: "var(--gh-warning)", label: "nearly out" },
  exhausted: { pill: "bg-gh-critical/10 text-gh-critical", bar: "var(--gh-critical)", label: "spent" },
};

const STATUS_META: Record<Row["status"], { label: string; color: string; bg: string }> = {
  db: { label: "Set in Settings", color: "#0b7a0b", bg: "#e2f6e2" },
  env: { label: "Using .env fallback", color: "#0b5e85", bg: "#e2f3fb" },
  unset: { label: "Not configured", color: "#a3272a", bg: "#fbdcdc" },
};

export function SettingsForm({ rows: initialRows }: { rows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  // Balances, fetched on the client and on demand. Ten live vendor calls
  // rendered server-side would put a multi-second wall in front of a page
  // whose main job — editing a key — does not need them, and a number that
  // only updates on a full reload is the wrong shape for "did that search just
  // spend the last of it?"
  const [usage, setUsage] = useState<Record<string, VendorUsage>>({});
  const [loadingUsage, setLoadingUsage] = useState(true);

  const loadUsage = useCallback(async () => {
    setLoadingUsage(true);
    try {
      const res = await fetch("/api/vendor-usage");
      const body = (await res.json()) as { vendors?: VendorUsage[] };
      const byId: Record<string, VendorUsage> = {};
      for (const v of body.vendors ?? []) byId[v.id] = v;
      setUsage(byId);
    } catch {
      // A balance we could not read is shown as absent, never as zero — the
      // difference between "out of credit" and "could not reach the vendor"
      // decides whether he tops up or checks his network.
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  // The six vendor keys are the job. The model overrides and the spare Apify
  // account are an escape hatch, and putting them in the same flat list made
  // the page read as ten equally-important things to fill in.
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      setFeedback((f) => ({ ...f, [key]: "Saved. Takes effect on the next search." }));
    } catch (e) {
      setFeedback((f) => ({ ...f, [key]: (e as Error).message }));
    } finally {
      setSaving(null);
    }
  }

  const main = rows.filter((r) => !r.advanced);
  const advanced = rows.filter((r) => r.advanced);

  const renderRow = (row: Row) => {
    const meta = STATUS_META[row.status];
    return (
      <div key={row.key} className="rounded-xl border border-gh-border bg-gh-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2.5">
            {row.logo ? (
              <Image
                src={row.logo}
                alt=""
                width={20}
                height={20}
                className="mt-0.5 shrink-0 rounded"
                unoptimized
              />
            ) : (
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gh-navy/[0.08] text-[10px] font-bold text-gh-navy">
                AI
              </span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gh-ink">{row.label}</p>
              {/* The reason this row exists. Without it "Judging model" is a
                  box nobody can safely decide about. */}
              <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-gh-ink-secondary">
                {row.what}
              </p>
            </div>
          </div>
          <span
            className="inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ color: meta.color, background: meta.bg }}
          >
            {meta.label}
          </span>
        </div>

        {row.masked && (
          <p className="mt-2 font-mono text-xs text-gh-ink-muted">{row.masked}</p>
        )}

        {/* WHAT IS LEFT, on the same card as the key that spends it. These were
            two separate lists on this page — balances at the top, keys at the
            bottom — so "Apify is empty, where do I paste the new token" meant
            scrolling between two sections that never named each other. */}
        {(() => {
          const u = row.usageId ? usage[row.usageId] : undefined;
          if (!row.usageId) return null;
          if (!u) {
            return (
              <p className="mt-2 text-xs text-gh-ink-muted">
                {loadingUsage ? "Checking balance…" : "Balance unavailable right now."}
              </p>
            );
          }
          const lv = LEVEL[u.warnLevel];
          return (
            <div className="mt-2.5 rounded-lg bg-gh-surface-sunken px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${lv.pill}`}>
                  {lv.label}
                </span>
                <span className="text-xs font-medium text-gh-ink">{u.headline}</span>
              </div>
              {/* No bar when the vendor exposes no denominator — an invented
                  one would be a picture of a number we do not have. */}
              {u.percentUsed !== null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gh-border">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.min(100, u.percentUsed)}%`, background: lv.bar }}
                  />
                </div>
              )}
              {(u.detail.length > 0 || u.resetNote) && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-gh-ink-secondary">
                  {[...u.detail, u.resetNote].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          );
        })()}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            autoComplete="off"
            value={drafts[row.key] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
            placeholder="Enter a new value to change"
            className="min-w-[200px] flex-1 rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
          />
          <button
            type="button"
            onClick={() => save(row.key)}
            disabled={saving === row.key || !(drafts[row.key] ?? "").trim()}
            className="cursor-pointer rounded-lg bg-gh-navy px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving === row.key ? "Saving…" : "Save"}
          </button>
        </div>

        {/* Where to actually GET or top up this key, so it is one click rather
            than a search. */}
        {row.link && (
          <a
            href={row.link}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded text-[11px] font-semibold text-gh-sky underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            {row.linkLabel ?? "Open dashboard"} ↗
          </a>
        )}

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
  };

  return (
    <div className="space-y-3">
      {main.map(renderRow)}

      {advanced.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-1.5 text-xs font-semibold text-gh-ink-muted transition-colors duration-200 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`}
            />
            {showAdvanced ? "Hide advanced" : `Advanced (${advanced.length})`}
          </button>
          {showAdvanced && (
            <>
              <p className="px-1 text-xs leading-relaxed text-gh-ink-muted">
                Optional. Everything works without these, and changing the
                judging model changes the quality of every lead.
              </p>
              {advanced.map(renderRow)}
            </>
          )}
        </>
      )}
    </div>
  );
}
