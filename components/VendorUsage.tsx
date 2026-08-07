"use client";

import { useCallback, useEffect, useState } from "react";
// TYPE ONLY. lib/vendor-usage.ts is server-only — it resolves real API keys —
// and this import is erased at build time. Never turn it into a value import.
import type { VendorUsage as VendorUsageRow, WarnLevel } from "@/lib/vendor-usage";

/**
 * Every vendor's balance in one place.
 *
 * Client-side and on demand rather than rendered on the server with the rest
 * of the Settings page, for two reasons: ten live vendor calls would put a
 * multi-second wall in front of a page whose main job (editing an API key) has
 * nothing to do with them, and a number that only refreshes on a full page
 * load is the wrong shape for "did that search just use up the last of it?"
 * Hence the Refresh button.
 */

const LEVEL_STYLES: Record<WarnLevel, { pill: string; card: string; bar: string }> = {
  // "ok" stays deliberately quiet — a healthy vendor shouldn't compete for
  // attention with a spent one two cards over.
  ok: {
    pill: "bg-gh-surface-sunken text-gh-ink-secondary",
    card: "border-gh-border",
    bar: "var(--gh-sky)",
  },
  // gh-warning is a bright amber: readable as a fill or a wash, not as text
  // on white. So the pill uses it as a background with ink on top.
  near: {
    pill: "bg-gh-warning/25 text-gh-ink",
    card: "border-gh-warning/60",
    bar: "var(--gh-warning)",
  },
  exhausted: {
    pill: "bg-gh-critical/10 text-gh-critical",
    card: "border-gh-critical/50",
    bar: "var(--gh-critical)",
  },
};

const LEVEL_LABEL: Record<WarnLevel, string> = {
  ok: "ok",
  near: "nearly out",
  exhausted: "spent",
};

export function VendorUsage() {
  const [rows, setRows] = useState<VendorUsageRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState("");

  // Nothing in here writes state synchronously — every setState sits after the
  // awaited fetch. That's what lets the mount effect below call it directly:
  // React's set-state-in-effect rule fires on a synchronous write in an effect
  // body, and the "Checking…" flag doesn't need one anyway (`loading` starts
  // true, and Refresh flips it from an event handler).
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor-usage", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const body = (await res.json()) as { vendors?: VendorUsageRow[] };
      setRows(body.vendors ?? []);
      setError("");
      setCheckedAt(
        new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      );
    } catch (e) {
      setError((e as Error).message || "Could not read vendor usage.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Same fetch-on-mount shape as lib/searches-store.tsx's refreshFolders
  // effect, deliberately. react-hooks/set-state-in-effect flags both: the rule
  // sees setState anywhere inside the called function and can't tell that
  // every write here happens after an awaited fetch, so there's no synchronous
  // cascade to avoid. Working around it (a setTimeout(0), a duplicated inline
  // IIFE) would cost real readability to satisfy a rule this codebase already
  // answers the same way everywhere else.
  useEffect(() => {
    void load();
  }, [load]);

  function refresh() {
    setLoading(true);
    void load();
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold text-gh-ink">Vendor usage</h2>
          <p className="mt-0.5 text-sm text-gh-ink-secondary">
            What&apos;s left at each vendor, read live — and for the monthly ones,
            the day the quota is full again.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {checkedAt && !loading && (
            <span className="text-xs text-gh-ink-muted">checked {checkedAt}</span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-lg border border-gh-border bg-gh-surface px-3 py-1.5 text-xs font-semibold text-gh-ink transition-colors hover:bg-gh-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs font-medium text-gh-critical">{error}</p>}

      {/* Skeletons only on the FIRST load. A refresh keeps the previous numbers
          on screen instead of blanking the section, so nothing jumps under the
          cursor while the button says "Checking…". */}
      {rows === null && !error && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[120px] animate-pulse rounded-xl border border-gh-border bg-gh-surface"
            />
          ))}
        </div>
      )}

      {rows !== null && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {rows.map((row) => (
            <VendorCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

function VendorCard({ row }: { row: VendorUsageRow }) {
  const styles = LEVEL_STYLES[row.warnLevel];

  return (
    <div
      className={`flex flex-col rounded-xl border bg-gh-surface p-4 ${
        row.ok ? styles.card : "border-gh-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gh-ink">{row.vendor}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            row.ok ? styles.pill : "bg-gh-surface-sunken text-gh-ink-muted"
          }`}
        >
          {row.ok ? LEVEL_LABEL[row.warnLevel] : "unreadable"}
        </span>
      </div>

      <p
        className={`tabular mt-2 text-base font-semibold ${
          row.ok ? "text-gh-ink" : "text-gh-ink-secondary"
        }`}
      >
        {row.headline}
      </p>

      {row.percentUsed !== null && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-gh-surface-sunken">
            <div
              className="h-full rounded-full transition-[width]"
              style={{
                // Clamped for the BAR only. warnLevel already read the true
                // figure, so an account at 100.2% still shows as spent — it
                // just can't overflow its track.
                width: `${Math.min(100, Math.max(0, row.percentUsed))}%`,
                background: styles.bar,
              }}
            />
          </div>
          <p className="tabular mt-1 text-[11px] text-gh-ink-muted">
            {Math.round(row.percentUsed)}% used
          </p>
        </div>
      )}

      {row.resetNote && (
        <p
          className={`mt-2 text-xs font-medium ${
            row.resetsAt ? "text-gh-ink-secondary" : "text-gh-ink-muted"
          }`}
        >
          {row.resetsAt ? "↻ " : ""}
          {row.resetNote}
        </p>
      )}

      {row.detail.length > 0 && (
        <ul className="mt-2 space-y-1">
          {row.detail.map((line, i) => (
            <li key={i} className="text-[11px] leading-relaxed text-gh-ink-muted">
              {line}
            </li>
          ))}
        </ul>
      )}

      {/* Always present, and the only thing on an unreadable card that still
          helps: when the number can't be fetched, or the answer is "top this
          up", the vendor's own dashboard is where he has to go. */}
      <a
        href={row.dashboardUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 self-start text-[11px] font-semibold text-gh-sky hover:underline"
      >
        Open dashboard ↗
      </a>
    </div>
  );
}
