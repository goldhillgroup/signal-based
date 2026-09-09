"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearches, type SearchFolder } from "@/lib/searches-store";
import { folderTitle } from "@/lib/folder-title";
import { CheckIcon, ZapIcon, UsersIcon, XIcon } from "./icons";

/**
 * What has finished, and when.
 *
 * WHY IT EXISTS. Notifications were toasts and nothing else: they appeared,
 * they went, and there was nowhere to look one up afterwards. A run that
 * finishes while the tab is closed announced itself to nobody. Daniel asked
 * where he could go and check, which is the right question to ask of a
 * notification that only exists for four seconds.
 *
 * NOTHING IS STORED. Every line here is derived from the searches themselves --
 * when they finished, what they found, whether enrichment has run. A separate
 * notifications table would be a second copy of facts the folder already
 * holds, and the two would disagree the first time anything was deleted.
 *
 * "New" is per-browser, in localStorage: it is a reading position, not a fact
 * about the data, and storing it server-side would mean one person marking
 * something read on their laptop clears it on somebody else's.
 */

const SEEN_KEY = "gh-activity-seen";

/**
 * The reading position, read the way the rail's collapsed state is.
 *
 * useSyncExternalStore rather than an effect: localStorage is not there during
 * the server render, and setting state in an effect to fix that up triggers a
 * cascading render. Same pattern, same reason, as useRailCollapsed.
 */
const seenListeners = new Set<() => void>();
function subscribeSeen(fn: () => void) {
  seenListeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    seenListeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}
function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    // A browser refusing storage means everything reads as new, which is the
    // safe way round for a notification.
    return "";
  }
}

interface Item {
  id: string;
  at: string;
  kind: "search" | "enrichment";
  title: string;
  detail: string;
  ok: boolean;
}

function itemsFrom(folders: SearchFolder[], lastEnrichedAt: Record<string, string>): Item[] {
  const out: Item[] = [];
  for (const f of folders) {
    if (f.status === "complete" && f.finishedAt) {
      const leads = f.qualifiedCount + f.verifyCount + f.fitOnlyCount;
      out.push({
        id: `${f.id}:search`,
        at: f.finishedAt,
        kind: "search",
        title: folderTitle(f.label),
        detail:
          leads === 0
            ? "Finished, nothing matched"
            : `${leads} lead${leads === 1 ? "" : "s"} found`,
        ok: true,
      });
    }
    if (f.enrichmentStatus === "complete" || f.enrichmentStatus === "failed") {
      out.push({
        id: `${f.id}:enrich`,
        // When the newest contact on this folder was written, which is when
        // enrichment last put something there. Sorting by the SEARCH date
        // buried a folder enriched minutes ago under crawls from last week.
        at: lastEnrichedAt[f.id] ?? f.finishedAt ?? f.createdAt,
        kind: "enrichment",
        title: folderTitle(f.label),
        detail:
          f.enrichmentStatus === "failed"
            ? f.enrichmentError || "Enrichment did not finish"
            : f.contactsFound === 0
              ? "Looked for emails, found none"
              : `${f.contactsFound} email address${f.contactsFound === 1 ? "" : "es"} on file`,
        ok: f.enrichmentStatus === "complete",
      });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);
}

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function ActivityPanel({ collapsed }: { collapsed: boolean }) {
  const { folders } = useSearches();
  const [open, setOpen] = useState(false);
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => "");

  const [enrichedAt, setEnrichedAt] = useState<Record<string, string>>({});
  useEffect(() => {
    let off = false;
    fetch("/api/activity")
      .then((r) => r.json())
      .then((j) => {
        if (!off && j?.lastEnrichedAt) setEnrichedAt(j.lastEnrichedAt);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [folders]);

  const items = useMemo(() => itemsFrom(folders, enrichedAt), [folders, enrichedAt]);
  const unread = seen ? items.filter((i) => i.at > seen).length : items.length;

  const markRead = useCallback(() => {
    const newest = items[0]?.at ?? new Date().toISOString();
    try {
      localStorage.setItem(SEEN_KEY, newest);
    } catch {
      /* reading position only */
    }
    // storage events do not fire in the tab that made the change.
    seenListeners.forEach((l) => l());
  }, [items]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          markRead();
        }}
        title="What has finished"
        className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
          collapsed ? "justify-center px-0" : ""
        }`}
      >
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <ZapIcon className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-gh-orange px-1 text-[9px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        {!collapsed && <span>Activity</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Activity">
          <button
            type="button"
            aria-label="Close activity"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-gh-navy/30"
          />
          <aside className="relative flex h-full w-full max-w-sm flex-col border-l border-gh-border bg-gh-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-gh-border px-4 py-3">
              <p className="font-display text-sm font-semibold text-gh-ink">Activity</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="cursor-pointer rounded-lg p-1 text-gh-ink-muted transition-colors hover:bg-gh-surface-sunken hover:text-gh-ink"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {items.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-gh-ink-muted">
                  Nothing has finished yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((i) => (
                    <li key={i.id}>
                      <Link
                        href={`/dashboard/lists/${i.id.split(":")[0]}`}
                        onClick={() => setOpen(false)}
                        className="flex gap-2.5 rounded-lg border border-gh-border px-3 py-2.5 transition-colors hover:border-gh-sky/50"
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                            i.ok ? "bg-gh-sky/10 text-gh-navy" : "bg-gh-critical/10 text-gh-critical"
                          }`}
                        >
                          {i.kind === "enrichment" ? (
                            <UsersIcon className="h-3 w-3" />
                          ) : (
                            <CheckIcon className="h-3 w-3" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-gh-ink">
                            {i.title}
                          </span>
                          <span className="block text-[11px] text-gh-ink-secondary">{i.detail}</span>
                          <span className="mt-0.5 block text-[10px] text-gh-ink-muted">
                            {i.kind === "enrichment" ? "Emails" : "Search"} · {when(i.at)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
