"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useActivity, dayLabel, when, type ActivityItem } from "@/lib/activity";
import { ClockIcon, CheckIcon, UsersIcon } from "@/components/icons";

/**
 * Everything that has finished, newest first.
 *
 * A PAGE, not the drawer this started as. The drawer put the only place you
 * can look a run up behind a button the rail did not name, so you had to
 * remember it was there. History is somewhere you go.
 *
 * FILED BY DAY. Thirty rows of "3h ago" is a list you have to read from the
 * top every time; "Today / Yesterday / 2 September" lets you jump to the day
 * you are actually asking about.
 *
 * READ ON THE WAY OUT, not on arrival. Marking the whole list read the instant
 * it renders would clear the "New" pills out from under the person reading
 * them. The unread count on the rail drops when you leave the page, by which
 * point you have actually seen it.
 */

function Row({ item, isNew }: { item: ActivityItem; isNew: boolean }) {
  return (
    <li>
      <Link
        href={`/dashboard/lists/${item.searchId}`}
        className="flex items-start gap-3 rounded-xl border border-gh-border bg-gh-surface px-4 py-3 transition-colors hover:border-gh-sky/50"
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            item.ok ? "bg-gh-sky/10 text-gh-navy" : "bg-gh-critical/10 text-gh-critical"
          }`}
        >
          {item.kind === "enrichment" ? (
            <UsersIcon className="h-3.5 w-3.5" />
          ) : (
            <CheckIcon className="h-3.5 w-3.5" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-gh-ink">{item.title}</span>
            {isNew && (
              <span className="rounded-full bg-gh-orange/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gh-orange">
                New
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[13px] text-gh-ink-secondary">{item.detail}</span>
        </span>

        <span className="shrink-0 pt-0.5 text-right">
          <span className="block text-[11px] font-medium text-gh-ink-secondary">
            {item.kind === "enrichment" ? "Emails" : "Search"}
          </span>
          <span className="tabular block text-[11px] text-gh-ink-muted">{when(item.at)}</span>
        </span>
      </Link>
    </li>
  );
}

export default function HistoryPage() {
  const { items, seen, markRead } = useActivity();

  // The latest markRead, kept in a ref so the "mark read on the way out"
  // effect below can stay on an empty dependency list. Depending on markRead
  // directly would re-run its cleanup every time the folder list refreshed,
  // which is mid-visit -- exactly what this is avoiding.
  const latest = useRef(markRead);
  useEffect(() => {
    latest.current = markRead;
  }, [markRead]);
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = Date.now();
    // React's development double-invoke tears an effect down and rebuilds it
    // in the same tick. That is not a person leaving the page, and treating it
    // as one clears the "New" pills before they have been on screen for a
    // frame. Production never takes this branch.
    const mark = () => {
      if (Date.now() - mountedAt.current > 250) latest.current();
    };
    // pagehide as well as unmount, or closing the tab on this page leaves
    // everything still unread the next time it opens.
    window.addEventListener("pagehide", mark);
    return () => {
      window.removeEventListener("pagehide", mark);
      mark();
    };
  }, []);

  // Group runs, preserving the newest-first order the list already has.
  const days: { label: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at);
    const last = days[days.length - 1];
    if (last?.label === label) last.items.push(item);
    else days.push({ label, items: [item] });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
            <ClockIcon className="h-4 w-4" />
          </span>
          <h1 className="font-display text-xl font-semibold text-gh-ink">History</h1>
        </div>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-gh-ink-secondary">
          Every search and every email run that has finished, newest first. The
          pop-ups in the corner disappear after a few seconds; this does not.
        </p>
      </header>

      {days.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gh-border px-6 py-12 text-center">
          <p className="text-sm font-medium text-gh-ink">Nothing has finished yet.</p>
          <p className="mt-1 text-[13px] text-gh-ink-secondary">
            Run a search and it will be listed here when it is done.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {days.map((d) => (
            <section key={d.label} className="space-y-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gh-ink-muted">
                {d.label}
              </h2>
              {/* No reading position yet means this is the first look, and
                  pinning "New" on all twenty rows says nothing. The pills
                  start earning their colour from the second visit. */}
              <ul className="space-y-2">
                {d.items.map((i) => (
                  <Row key={i.id} item={i} isNew={!!seen && i.at > seen} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
