"use client";

import Link from "next/link";
import { folderTitle } from "@/lib/folder-title";
import { CountUp } from "./CountUp";
import { FolderIcon, SearchIcon } from "./icons";

/**
 * The last few searches, on the Overview page.
 *
 * Overview knew the totals but showed nothing that had actually happened, so
 * on a fresh account it was a row of zeros and three links. These rows are the
 * thing a returning user is looking for: what ran, what it found, what it cost.
 *
 * Entrance is staggered by 60ms per row. Not decoration: the sequence draws
 * the eye down the list in reading order and makes the newest row, which is
 * the one that matters, land first.
 */

export interface RecentRow {
  id: string;
  label: string;
  created_at: string;
  status: string;
  cost_estimate_usd: number | null;
  /** Counted from the company rows by the page, NOT from the search row's
   *  stored counters — see the comment in app/dashboard/overview/page.tsx for
   *  why those two disagreed. */
  leads: number;
  signals: number;
}

function whenLabel(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function RecentFolders({ rows }: { rows: RecentRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gh-border bg-gh-surface px-5 py-8 text-center">
        <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
          <SearchIcon className="h-4 w-4" />
        </span>
        <p className="mt-3 text-sm font-semibold text-gh-ink">No searches yet</p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-gh-ink-secondary">
          Run one and it lands here, with what it found and what it cost.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gh-navy px-4 py-2 text-xs font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          <SearchIcon className="h-3.5 w-3.5" />
          Start the first search
        </Link>
      </div>
    );
  }

  return (
    <div className="stagger space-y-2">
      {rows.map((r) => {
        const accepted = r.leads;
        const signals = r.signals;
        const running = r.status === "running";
        return (
          <Link
            key={r.id}
            href={`/dashboard/lists/${r.id}`}
            className="fade-up lift group flex items-center gap-3 rounded-xl border border-gh-border bg-gh-surface px-4 py-3 hover:border-gh-sky/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
              <FolderIcon className="h-4 w-4" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-gh-ink group-hover:text-gh-navy">
                {folderTitle(r.label)}
              </span>
              <span className="mt-0.5 block text-[11px] text-gh-ink-muted">
                {running ? "running now" : whenLabel(r.created_at)}
                {r.cost_estimate_usd ? ` · $${r.cost_estimate_usd.toFixed(2)}` : ""}
              </span>
            </span>

            {running ? (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-gh-sky/10 px-2.5 py-1 text-[11px] font-semibold text-gh-sky">
                <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-gh-sky" />
                running
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-right">
                  <span className="tabular block font-display text-base font-semibold leading-none text-gh-ink">
                    <CountUp value={accepted} />
                  </span>
                  <span className="block text-[10px] text-gh-ink-muted">leads</span>
                </span>
                {signals > 0 && (
                  <span className="text-right">
                    <span className="tabular block font-display text-base font-semibold leading-none text-gh-navy">
                      <CountUp value={signals} />
                    </span>
                    <span className="block text-[10px] text-gh-ink-muted">signals</span>
                  </span>
                )}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
