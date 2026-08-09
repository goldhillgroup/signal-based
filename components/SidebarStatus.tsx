"use client";

import Link from "next/link";
import { useSearches } from "@/lib/searches-store";
import { ZapIcon } from "./icons";

/**
 * The middle of the rail, which was a large empty field.
 *
 * Filled with status rather than decoration. A sidebar is looked at
 * constantly and read almost never, so the only things earning space here are
 * the ones that change and that change what you do next:
 *
 *   - is something running RIGHT NOW (so: do not start another)
 *   - how many real signals exist (the payload; the reason the tool exists)
 *
 * Both are already in the store from the folder list, so this costs no extra
 * query. The running row only appears while something runs, and disappears
 * again — a permanent "0 running" would be a line that says nothing 99% of
 * the time and trains you to stop looking at the one place that matters.
 */
export function SidebarStatus() {
  const { folders, loading } = useSearches();
  if (loading) return null;

  const running = folders.filter((f) => f.status === "running");
  const signals = folders.reduce((n, f) => n + f.qualifiedCount + f.verifyCount, 0);

  return (
    <div className="px-3 pb-3">
      {running.length > 0 && (
        <Link
          href={`/dashboard/lists/${running[0].id}`}
          className="mb-2 flex items-center gap-2.5 rounded-lg bg-gh-sky/10 px-3 py-2.5 transition-colors duration-200 hover:bg-gh-sky/15"
        >
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-gh-sky" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold text-white">
              {running.length === 1 ? "Search running" : `${running.length} searches running`}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-white/45">
              {running[0].label}
            </span>
          </span>
        </Link>
      )}

      {signals > 0 && (
        <div className="rounded-lg border border-white/10 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ZapIcon className="h-3.5 w-3.5 shrink-0 text-gh-lime" />
            <span className="tabular font-display text-lg font-semibold leading-none text-white">
              {signals}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-white/40">
              signal{signals === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-white/35">
            founder and successor, both confirmed
          </p>
        </div>
      )}
    </div>
  );
}
