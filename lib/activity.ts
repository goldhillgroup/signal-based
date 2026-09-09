"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSearches, type SearchFolder } from "@/lib/searches-store";
import { folderTitle } from "@/lib/folder-title";

/**
 * What has finished, and when.
 *
 * WHY IT EXISTS. Notifications were toasts and nothing else: they appeared,
 * they went, and there was nowhere to look one up afterwards. A run that
 * finishes while the tab is closed announced itself to nobody.
 *
 * WHY A PAGE AND NOT A PANEL. This was briefly a slide-in drawer hung off a
 * button under the nav, which made the one place you can look something up the
 * one place the rail does not name. History is a destination -- you go to it,
 * you can be linked to it, the back button works -- so it is a row in the nav
 * like everything else you can open.
 *
 * NOTHING IS STORED. Every line is derived from the searches themselves: when
 * they finished, what they found, whether enrichment has run. A notifications
 * table would be a second copy of facts the folder already holds, and the two
 * would disagree the first time anything was deleted.
 *
 * "New" is per-browser, in localStorage: it is a reading position, not a fact
 * about the data, and storing it server-side would mean marking something read
 * on a laptop clearing it on somebody else's screen.
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

export interface ActivityItem {
  id: string;
  /** The folder this opens. */
  searchId: string;
  at: string;
  kind: "search" | "enrichment";
  title: string;
  detail: string;
  ok: boolean;
}

export function itemsFrom(
  folders: SearchFolder[],
  lastEnrichedAt: Record<string, string>
): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const f of folders) {
    if (f.status === "complete" && f.finishedAt) {
      const leads = f.qualifiedCount + f.verifyCount + f.fitOnlyCount;
      out.push({
        id: `${f.id}:search`,
        searchId: f.id,
        at: f.finishedAt,
        kind: "search",
        title: folderTitle(f.label),
        detail:
          leads === 0 ? "Finished, nothing matched" : `${leads} lead${leads === 1 ? "" : "s"} found`,
        ok: true,
      });
    }
    if (f.enrichmentStatus === "complete" || f.enrichmentStatus === "failed") {
      out.push({
        id: `${f.id}:enrich`,
        searchId: f.id,
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
  // No slice. This is the history page now, and a history that quietly stops
  // at thirty is one you cannot trust to answer "did that ever run".
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** "Today", "Yesterday", then the date. The heading a run gets filed under. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(today) - midnight(d)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

/**
 * The history, plus how much of it is new.
 *
 * Used by BOTH the nav badge and the page, so the number on the rail can never
 * mean something different from the list it opens.
 */
export function useActivity() {
  const { folders } = useSearches();
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
    // NOW, not the newest item's timestamp. Reading the list means everything
    // that had happened by the time you read it is read; keying on items[0]
    // leaves anything the /api/activity fetch had not yet re-dated stuck as
    // unread forever. Never moves backwards.
    if (items.length === 0) return;
    const newest = new Date().toISOString();
    if (newest <= readSeen()) return;
    try {
      localStorage.setItem(SEEN_KEY, newest);
    } catch {
      /* reading position only */
    }
    // storage events do not fire in the tab that made the change.
    seenListeners.forEach((l) => l());
  }, [items]);

  return { items, unread, seen, markRead };
}
