"use client";

/**
 * Tells you when something you started in the background has finished.
 *
 * WHAT WENT WRONG WITHOUT IT. Enrichment runs detached: the request returns
 * immediately and the work carries on server-side, which is right, because the
 * alternative is a browser tab that must stay open for four minutes. But the
 * only thing watching it was a poll inside the folder page. Leave that page,
 * or open a different folder, and the pass finished into silence. Daniel ran
 * one, went and did something else, and came back to a screen that looked
 * exactly as it had before -- the address had been bought, written, and was
 * sitting in the database, and nothing anywhere said so.
 *
 * A bell used to sit in the top bar with no click handler, which was worse
 * than nothing: it implied notifications existed. It was removed. This is the
 * thing it should have been.
 *
 * WHY IT LIVES IN THE LAYOUT. The point is to reach you wherever you are, so
 * it cannot belong to any one page. It sits beside the tour in the dashboard
 * layout and watches the shared folder store.
 *
 * WHY IT POLLS ONLY WHEN THERE IS SOMETHING TO WATCH. An interval that runs
 * forever is a request every few seconds for the entire time the tab is open,
 * on a database this is billed against. It starts when a folder is running and
 * stops the moment none is, so an idle dashboard costs nothing.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearches } from "@/lib/searches-store";
import { CheckIcon, ZapIcon, XIcon, UsersIcon } from "./icons";

interface Finished {
  id: string;
  label: string;
  kind: "enrichment" | "search";
  ok: boolean;
  detail: string;
}

const POLL_MS = 4000;

export function BackgroundWatch() {
  const { folders, refreshFolders } = useSearches();
  const [done, setDone] = useState<Finished[]>([]);

  // What each folder was doing last time we looked. A notification fires on a
  // TRANSITION, never on a state: without this, a folder sitting at "complete"
  // would re-announce itself on every poll for as long as the tab was open.
  const seen = useRef<Map<string, string>>(new Map());
  // First pass records where everything already stands and announces nothing.
  // Otherwise opening the dashboard would toast every enrichment ever run.
  const primed = useRef(false);

  useEffect(() => {
    const next = new Map<string, string>();
    const fresh: Finished[] = [];

    for (const f of folders) {
      const key = `${f.status}:${f.enrichmentStatus}`;
      next.set(f.id, key);
      const before = seen.current.get(f.id);
      if (!primed.current || before === undefined || before === key) continue;

      const wasEnriching = before.endsWith(":running");
      const nowSettled =
        f.enrichmentStatus === "complete" || f.enrichmentStatus === "failed";
      if (wasEnriching && nowSettled) {
        const n = f.contactsFound ?? 0;
        fresh.push({
          id: f.id,
          label: f.label,
          kind: "enrichment",
          ok: f.enrichmentStatus === "complete",
          detail:
            f.enrichmentStatus === "failed"
              ? f.enrichmentError || "Something went wrong."
              : n === 0
                ? "No addresses found this time. You were not charged."
                : `${n} email address${n === 1 ? "" : "es"} found.`,
        });
      }

      const wasSearching = before.startsWith("running:");
      if (wasSearching && f.status === "complete") {
        const leads = f.qualifiedCount + f.verifyCount + f.fitOnlyCount;
        fresh.push({
          id: f.id,
          label: f.label,
          kind: "search",
          ok: true,
          detail: `${leads} lead${leads === 1 ? "" : "s"} found.`,
        });
      }
    }

    seen.current = next;
    if (!primed.current) {
      primed.current = true;
      return;
    }
    // DEFERRED, not called straight from the effect body.
    //
    // Setting state synchronously inside an effect that reads `folders`
    // schedules a second render before the first has been committed, which is
    // the cascading-render pattern React warns about and the same mistake that
    // made the theme toggle flicker. A notification is by nature a reaction to
    // data that has already landed, so a microtask later is both correct and
    // what the user sees anyway.
    if (fresh.length) {
      queueMicrotask(() => setDone((prev) => [...fresh, ...prev].slice(0, 3)));
    }
  }, [folders]);

  // Poll only while something is actually in flight.
  const busy = folders.some(
    (f) => f.status === "running" || f.enrichmentStatus === "running"
  );
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      refreshFolders();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [busy, refreshFolders]);

  if (done.length === 0) return null;

  return (
    // Bottom-left, clear of the "New search" button top-right and of the
    // tour's card. aria-live so a screen reader hears it arrive; polite
    // rather than assertive, because nothing here interrupts a task.
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {done.map((d) => (
        <div
          key={`${d.id}-${d.kind}`}
          className="fade-up pointer-events-auto rounded-xl border border-gh-border bg-gh-surface p-3 shadow-lg"
        >
          <div className="flex items-start gap-2.5">
            <span
              className={`mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                d.ok ? "bg-gh-good/10 text-gh-good" : "bg-gh-critical/10 text-gh-critical"
              }`}
            >
              {d.kind === "enrichment" ? (
                <UsersIcon className="h-3.5 w-3.5" />
              ) : d.ok ? (
                <CheckIcon className="h-3.5 w-3.5" />
              ) : (
                <ZapIcon className="h-3.5 w-3.5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gh-ink">
                {d.kind === "enrichment" ? "Email lookup finished" : "Search finished"}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-gh-ink-muted" title={d.label}>
                {d.label}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gh-ink-secondary">{d.detail}</p>
              <Link
                href={`/dashboard/lists/${d.id}`}
                onClick={() => setDone((prev) => prev.filter((x) => x !== d))}
                className="mt-1.5 inline-block text-[11px] font-semibold text-gh-sky hover:underline"
              >
                Open the list
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setDone((prev) => prev.filter((x) => x !== d))}
              aria-label="Dismiss"
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gh-ink-muted transition-colors hover:bg-gh-surface-sunken hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
