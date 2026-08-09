"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearches, type SearchFolder } from "@/lib/searches-store";
import { Company } from "@/lib/company";
import { getSummaryStats } from "@/lib/stats";
import { downloadCompaniesCsv } from "@/lib/csv-export";
import { CompaniesTable } from "@/components/CompaniesTable";
import { CompanyDrawer } from "@/components/CompanyDrawer";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CountUp } from "@/components/CountUp";
import {
  ArrowLeftIcon,
  DownloadIcon,
  FolderIcon,
  RadarIcon,
  TrashIcon,
} from "@/components/icons";

/**
 * Every lead ever found, ONE FOLDER AT A TIME, and folders first.
 *
 * Three rules, all learned the hard way:
 *
 * 1. THE FRONT DOOR IS A LIST OF FOLDERS, not a table. Earlier versions opened
 *    straight onto one folder's rows with the others as chips above them,
 *    which answered "what is in this folder" before he had asked which folder.
 *    You now pick, then look. There is no "Everything" any more either: a
 *    combined table grows without bound, so it got less useful every week, and
 *    it was never the question anyone actually had.
 *
 * 2. THE FOLDER IS NAMED FOR WHAT IS IN IT; the date is a specification, not a
 *    title. An interim version keyed on the day ("Today", "Yesterday") and that
 *    was wrong: a date cannot tell you whether a folder holds landscapers in
 *    Texas or home builders in Florida, and once the weekly harvest runs there
 *    are two folders sharing every date.
 *
 * 3. ONLY LEADS. Rejected companies are not shown here, or anywhere else in the
 *    dashboard. They are still stored and still drive the recheck schedule.
 *
 * The folder date shown is `createdAt` — when the search ran — not the
 * company's own first_seen_at. Those differ for a company re-examined later by
 * recheck-policy.ts: it keeps its original discovery date, but the folder that
 * surfaced it is dated the day it ran, which is what "when was this scraped"
 * actually means.
 */
export default function AllLeadsPage() {
  const { fetchAllCompanies, folders, deleteSearch } = useSearches();
  const [companies, setCompanies] = useState<Company[] | "loading">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SearchFolder | null>(null);
  const [error, setError] = useState("");

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

  // Folders that actually contributed a lead, newest first. An empty folder is
  // a dead card.
  const counts = new Map<string, number>();
  const signals = new Map<string, number>();
  for (const c of companies) {
    if (!c.searchId) continue;
    counts.set(c.searchId, (counts.get(c.searchId) ?? 0) + 1);
    if (c.hasSignal) signals.set(c.searchId, (signals.get(c.searchId) ?? 0) + 1);
  }
  const contributing = folders.filter((f) => counts.has(f.id));
  const openFolder = contributing.find((f) => f.id === openFolderId) ?? null;

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setError("");
    try {
      await deleteSearch(target.id);
      if (openFolderId === target.id) setOpenFolderId(null);
      setCompanies((prev) =>
        prev === "loading" ? prev : prev.filter((c) => c.searchId !== target.id)
      );
    } catch (e) {
      setError((e as Error).message || "Could not delete that folder.");
    }
  }

  const deleteDialog = (
    <ConfirmDialog
      open={pendingDelete !== null}
      destructive
      requirePhrase="DELETE"
      title="Delete this folder for good?"
      confirmLabel="Delete permanently"
      cancelLabel="Keep it"
      onConfirm={confirmDelete}
      onCancel={() => setPendingDelete(null)}
      body={
        pendingDelete && (
          <>
            <p>
              <strong className="font-semibold text-gh-ink">{pendingDelete.label}</strong> and its{" "}
              <strong className="font-semibold text-gh-ink">
                {counts.get(pendingDelete.id) ?? 0} leads
              </strong>{" "}
              will be removed, along with every email found for them.
            </p>
            {/* The non-obvious half. Those rows ARE the cross-search memory,
                so deleting them makes the next search rediscover and re-pay
                for the same companies. Nobody would guess that from the word
                "delete", so it has to be said before the click, not after. */}
            <p className="mt-2">
              Signal Radar will also forget that it ever checked these
              companies, so a future search will find and pay for them again.
            </p>
            <p className="mt-2 font-medium text-gh-critical">This cannot be undone.</p>
          </>
        )
      }
    />
  );

  // ── Level 2: one folder's leads ──────────────────────────────────────────
  if (openFolder) {
    const visible = companies.filter((c) => c.searchId === openFolder.id);
    const stats = getSummaryStats(visible);
    const selected = visible.find((c) => c.id === selectedId) ?? null;

    return (
      <div className="mx-auto max-w-7xl space-y-6">
        {deleteDialog}

        <div>
          <button
            type="button"
            onClick={() => {
              setOpenFolderId(null);
              setSelectedId(null);
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gh-ink-muted transition-colors hover:text-gh-ink"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            All folders
          </button>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold text-gh-ink">
                {openFolder.label}
              </h1>
              <p className="mt-1 text-sm text-gh-ink-secondary">
                {stats.total} lead{stats.total === 1 ? "" : "s"} · scraped{" "}
                {dayLabel(dayKey(openFolder.createdAt))}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(openFolder)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gh-border bg-gh-surface px-3 py-2.5 text-sm font-semibold text-gh-ink-secondary transition-colors duration-200 hover:border-gh-critical/50 hover:text-gh-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-critical/30"
              >
                <TrashIcon className="h-4 w-4" />
                Delete
              </button>
              <button
                type="button"
                onClick={() => downloadCompaniesCsv(visible, slugify(openFolder.label))}
                disabled={visible.length === 0}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gh-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <DownloadIcon className="h-4 w-4" />
                Download {visible.length}
              </button>
            </div>
          </div>
        </div>

        {error && <p className="text-xs font-medium text-gh-critical">{error}</p>}

        <CompaniesTable
          key={openFolder.id}
          companies={visible}
          onRowClick={(c) => setSelectedId(c.id)}
        />

        <CompanyDrawer company={selected} onClose={() => setSelectedId(null)} />
      </div>
    );
  }

  // ── Level 1: the folders ─────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {deleteDialog}

      <div>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
            <RadarIcon className="h-4 w-4" />
          </span>
          <h1 className="font-display text-2xl font-semibold text-gh-ink">All leads</h1>
        </div>
        <p className="mt-1 text-sm text-gh-ink-secondary">
          {contributing.length === 0
            ? "No leads yet."
            : `${companies.length} leads across ${contributing.length} folder${contributing.length === 1 ? "" : "s"}. Open one to see them.`}
        </p>
      </div>

      {error && <p className="text-xs font-medium text-gh-critical">{error}</p>}

      {contributing.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gh-border bg-gh-surface p-10 text-center text-sm text-gh-ink-muted">
          Nothing here yet -{" "}
          <Link href="/dashboard" className="font-medium text-gh-sky hover:underline">
            run a search
          </Link>{" "}
          to start finding leads.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {contributing.map((f, i) => (
            <div
              key={f.id}
              className="fade-up group relative rounded-xl border border-gh-border bg-gh-surface transition-colors duration-200 hover:border-gh-sky/50"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <button
                type="button"
                onClick={() => setOpenFolderId(f.id)}
                className="w-full cursor-pointer p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
                  <FolderIcon className="h-4 w-4" />
                </span>
                {/* pr-8 keeps the title clear of the delete button parked in
                    the corner — without it a long label runs underneath it and
                    the last word is unreadable. */}
                <p className="mt-3 pr-8 text-sm font-semibold leading-snug text-gh-ink group-hover:text-gh-navy">
                  {f.label}
                </p>
                <p className="mt-0.5 text-[11px] text-gh-ink-muted">
                  scraped {dayLabel(dayKey(f.createdAt))}
                </p>

                <div className="mt-3 flex items-end gap-4 border-t border-gh-border pt-3">
                  <span>
                    <span className="tabular block font-display text-xl font-semibold leading-none text-gh-ink">
                      <CountUp value={counts.get(f.id) ?? 0} />
                    </span>
                    <span className="mt-0.5 block text-[10px] text-gh-ink-muted">leads</span>
                  </span>
                  {(signals.get(f.id) ?? 0) > 0 && (
                    <span>
                      <span className="tabular block font-display text-xl font-semibold leading-none text-gh-navy">
                        <CountUp value={signals.get(f.id) ?? 0} />
                      </span>
                      <span className="mt-0.5 block text-[10px] text-gh-ink-muted">signals</span>
                    </span>
                  )}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPendingDelete(f)}
                aria-label={`Delete ${f.label}`}
                title="Delete this folder"
                className="absolute right-2 top-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-gh-ink-muted transition-colors duration-200 hover:bg-gh-critical/10 hover:text-gh-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-critical/30"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
 * Local calendar day, not UTC. `created_at` is an ISO instant, and slicing
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
