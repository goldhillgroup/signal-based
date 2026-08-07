"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearches } from "@/lib/searches-store";
import { Company } from "@/lib/company";
import { getSummaryStats } from "@/lib/stats";
import { downloadCompaniesCsv } from "@/lib/csv-export";
import { CompaniesTable } from "@/components/CompaniesTable";
import { CompanyDrawer } from "@/components/CompanyDrawer";
import { DownloadIcon, RadarIcon } from "@/components/icons";

// Every accepted company across every search, SCOPED ONE FOLDER AT A TIME.
//
// Two rules, both learned the hard way:
//
// 1. NEVER open on everything. The combined view grows without bound, so the
//    page got less useful every week — this week's twelve new leads sat mixed
//    into hundreds already worked. It opens on the newest folder instead.
//    "Everything" stays reachable for a full export, last and behind a rule.
//
// 2. THE FOLDER IS NAMED FOR WHAT IS IN IT; the date is a specification, not
//    a title. An interim version keyed on the day ("Today", "Yesterday") and
//    that was wrong: a date cannot tell you whether a folder holds landscapers
//    in Texas or home builders in Florida, and once the weekly harvest runs
//    there are two folders sharing every date. Topic on the chip, date beneath.
//
// The folder date shown is `createdAt` — when the search ran — not the
// company's own first_seen_at. Those differ for a company re-examined later by
// recheck-policy.ts: it keeps its original discovery date, but the folder that
// surfaced it is dated the day it ran, which is what "when was this scraped"
// actually means.
export default function AllLeadsPage() {
  const { fetchAllCompanies, folders } = useSearches();
  const [companies, setCompanies] = useState<Company[] | "loading">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllCompanies().then((c) => {
      if (!cancelled) setCompanies(c);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (companies === "loading") return null;

  // Folders that actually contributed a lead, newest first. An empty folder
  // in the picker is a dead option.
  const counts = new Map<string, number>();
  for (const c of companies) {
    if (c.searchId) counts.set(c.searchId, (counts.get(c.searchId) ?? 0) + 1);
  }
  const contributing = folders.filter((f) => counts.has(f.id));

  // Opens on the most recent folder — never on everything.
  const activeId = folderFilter ?? contributing[0]?.id ?? null;
  const showingAll = folderFilter === ALL;
  const activeFolder = contributing.find((f) => f.id === activeId) ?? null;

  const visible = showingAll
    ? companies
    : companies.filter((c) => c.searchId === activeId);

  const stats = getSummaryStats(visible);
  const selected = visible.find((c) => c.id === selectedId) ?? null;
  const scopeKey = showingAll ? ALL : (activeId ?? "none");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
              <RadarIcon className="h-4 w-4" />
            </span>
            <h1 className="font-display text-2xl font-semibold text-gh-ink">All leads</h1>
          </div>
          <p className="mt-1 text-sm text-gh-ink-secondary">
            {showingAll
              ? `Every lead ever found — ${stats.total} total.`
              : activeFolder
                ? `${stats.total} lead${stats.total === 1 ? "" : "s"} · scraped ${dayLabel(dayKey(activeFolder.createdAt))}`
                : "No leads yet."}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            downloadCompaniesCsv(
              visible,
              showingAll ? "all-leads" : slugify(activeFolder?.label ?? "leads")
            )
          }
          disabled={visible.length === 0}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-gh-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <DownloadIcon className="h-4 w-4" />
          Download {visible.length}
        </button>
      </div>

      {/* Folders, newest first. The chip is named for WHAT was scraped; the
          date rides underneath as a specification. A date makes a poor title —
          "Aug 7" does not tell you whether it holds landscapers in Texas or
          home builders in Florida, and once the weekly harvest is running
          there will be two folders sharing every date. "Everything" sits last
          behind a divider: reachable for a full export, never the front door. */}
      {contributing.length > 0 && (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div role="group" aria-label="Filter by folder" className="flex w-max items-center gap-1.5">
            {contributing.map((f) => (
              <FolderChip
                key={f.id}
                active={!showingAll && f.id === activeId}
                onClick={() => setFolderFilter(f.id)}
                label={f.label}
                when={dayLabel(dayKey(f.createdAt))}
                count={counts.get(f.id) ?? 0}
              />
            ))}
            <span aria-hidden className="mx-1 h-8 w-px shrink-0 bg-gh-border" />
            <FolderChip
              active={showingAll}
              onClick={() => setFolderFilter(ALL)}
              label="Everything"
              when={`${contributing.length} folders`}
              count={companies.length}
            />
          </div>
        </div>
      )}

      {companies.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gh-border bg-gh-surface p-10 text-center text-sm text-gh-ink-muted">
          Nothing here yet —{" "}
          <Link href="/dashboard" className="font-medium text-gh-sky hover:underline">
            run a search
          </Link>{" "}
          to start finding leads.
        </p>
      ) : (
        /* key remounts the table when the scope changes. It picks its opening
           tab with a useState initialiser ("first tab that actually has
           results"), which only runs on mount — without this, switching to a
           day whose leads are all fit-only kept the stale "Qualified" tab and
           showed "No companies match these filters" over real leads. */
        <CompaniesTable
          key={scopeKey}
          companies={visible}
          onRowClick={(c) => setSelectedId(c.id)}
        />
      )}

      <CompanyDrawer company={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

/**
 * Topic on top, date underneath. The label answers "what is in here"; the date
 * only distinguishes two folders that would otherwise read identically — which
 * is exactly what a weekly harvest produces, week after week.
 */
function FolderChip({
  active,
  onClick,
  label,
  when,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  when: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
        active
          ? "border-gh-navy bg-gh-navy text-white"
          : "border-gh-border bg-gh-surface hover:border-gh-sky/40"
      }`}
    >
      <span className="min-w-0">
        <span
          className={`block max-w-[15rem] truncate text-xs font-semibold ${
            active ? "text-white" : "text-gh-ink"
          }`}
        >
          {label}
        </span>
        <span
          className={`block text-[10px] font-medium ${
            active ? "text-white/60" : "text-gh-ink-muted"
          }`}
        >
          {when}
        </span>
      </span>
      <span
        className={`tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
          active ? "bg-white/15 text-white" : "bg-gh-surface-sunken text-gh-ink-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/** Sentinel for the un-scoped view. Not a uuid, so it can never collide. */
const ALL = "__all__";

/** Filename-safe form of a folder label, for the scoped CSV download. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "leads"
  );
}

/**
 * Local calendar day, not UTC. `first_seen_at` is an ISO instant, and slicing
 * the first 10 characters off it buckets by UTC — which puts anything the
 * pipeline finds after 5pm Pacific into "tomorrow" for a user in California.
 * Jonathan is in LA, and a scheduled overnight harvest lands squarely in that
 * window, so this has to be the viewer's day.
 */
function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function dayLabel(key: string | null): string {
  if (!key) return "No date";
  const today = dayKey(new Date().toISOString());
  if (key === today) return "Today";

  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === dayKey(y.toISOString())) return "Yesterday";

  // Parsed as local midnight — `new Date("2026-08-05")` would be UTC midnight
  // and could render as Aug 4 west of Greenwich.
  const [yy, mm, dd] = key.split("-").map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
