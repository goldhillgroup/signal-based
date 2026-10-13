"use client";

import { useEffect, useRef, useState } from "react";
import { folderTitle } from "@/lib/folder-title";
import Link from "next/link";
import { useSearches, type SearchFolder } from "@/lib/searches-store";
import type { Company, LeadSummary } from "@/lib/company";

import { downloadCompaniesCsv } from "@/lib/csv-export";
import { countDuplicates, dedupeCompanies } from "@/lib/dedupe";
import { XlsxButton } from "@/components/XlsxButton";
import { useMarks } from "@/lib/use-marks";
import { CompaniesTable } from "@/components/CompaniesTable";
import { CompanyDrawer } from "@/components/CompanyDrawer";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WhyTheseAreNot } from "@/components/WhyTheseAreNot";
import { CountUp } from "@/components/CountUp";
import {
  ArrowLeftIcon,
  DownloadIcon,
  FolderIcon,
  PencilIcon,
  RadarIcon,
  TrashIcon,
} from "@/components/icons";
import { ENRICH_CEILING_PER_COMPANY_USD } from "@/lib/pipeline/pricing";
import { isWrongKindOfBusiness } from "@/lib/pipeline/recheck-policy";
import { SheetsButton } from "@/components/SheetsButton";

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
 *    Texas or home builders in Florida, and two searches on one day share a
 *    date while holding completely different things.
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
type FolderGroupBy = "none" | "month" | "state" | "trade" | "outcome";

const FOLDER_GROUPS: { key: FolderGroupBy; label: string }[] = [
  { key: "none", label: "Newest first" },
  { key: "month", label: "By month" },
  { key: "state", label: "By state" },
  { key: "trade", label: "By trade" },
  { key: "outcome", label: "By outcome" },
];

const TRADE_LABEL: Record<string, string> = {
  landscaping: "Landscaping",
  home_builder: "Home builders",
};

/**
 * Which pile a folder belongs in.
 *
 * Read off the LEADS INSIDE the folder rather than off the search row, because
 * the search row does not record its industry or states — only a query string
 * and a label, and a label he has renamed to "Tuesday call" says nothing about
 * either. The companies know, and they cannot disagree with themselves.
 */
function folderBucket(f: SearchFolder, leads: LeadSummary[], by: FolderGroupBy): string {
  if (by === "month") {
    return new Date(f.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (by === "state") {
    const states = [...new Set(leads.map((c) => c.state).filter((s) => s && s !== "-"))];
    if (states.length === 0) return "No state recorded";
    return states.length === 1 ? states[0] : `${states.length} states`;
  }
  if (by === "trade") {
    const trades = [...new Set(leads.map((c) => c.industry))];
    if (trades.length === 0) return "Empty";
    return trades.length === 1 ? TRADE_LABEL[trades[0]] ?? trades[0] : "Mixed trades";
  }
  // Outcome — the only grouping that answers "which of these actually worked",
  // which is the question after a few weeks of running searches.
  const signals = leads.filter((c) => c.hasSignal).length;
  if (signals > 0) return `Found signals`;
  return leads.length > 0 ? "Fit-only leads" : "Nothing found";
}

/**
 * The front door is drawn from one tiny row per lead, not from the leads.
 *
 * It used to download every company with its evidence quote and every contact
 * (780 KB on the live database, 2026-10-13) to print a count on a tile. Now the
 * tiles come from LeadSummary rows, a folder's full rows arrive when it is
 * opened, and every lead in full is fetched only when a combined export asks.
 *
 * The summaries are remembered for the life of the tab, so returning to this
 * page paints the tiles at once and the refresh lands behind them.
 */
let summaryMemory: LeadSummary[] | null = null;
/** Rows fetched for a combined export stay good for this long. */
const ALL_LEADS_TTL_MS = 60_000;

export default function AllLeadsPage() {
  const {
    fetchLeadSummaries,
    fetchAllLeads,
    fetchCompanies,
    folders,
    loading: foldersLoading,
    deleteSearch,
    renameSearch,
    startEnrichment,
  } = useSearches();
  const [summaries, setSummaries] = useState<LeadSummary[] | null>(summaryMemory);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  /** Full rows of every folder opened so far, keyed by folder. */
  const [opened, setOpened] = useState<Record<string, Company[]>>({});
  const [csvBusy, setCsvBusy] = useState(false);
  const allLeadsRef = useRef<{ at: number; rows: Promise<Company[]> } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  // HOW THE FOLDERS ARE DRAWN, not which rows are shown.
  //
  // This briefly switched between the folders and one table of every lead.
  // Wrong level: a folder page whose main control swaps in a completely
  // different subject makes "where am I" a question. The all-leads view lives
  // INSIDE a folder, as its first tab, which is where a lead list belongs.
  // Here the only real question is whether nine folders are easier to scan as
  // tiles or as rows, and past about six the answer changes.
  const [folderView, setFolderView] = useState<"cards" | "list">("cards");
  // Loaded here rather than beside the export button: hooks cannot sit after
  // an early return, and this component has one.
  const { withMarks } = useMarks();
  const [pendingDelete, setPendingDelete] = useState<SearchFolder | null>(null);
  /** Company ids picked for an email lookup, awaiting confirmation. */
  const [pendingPick, setPendingPick] = useState<string[] | null>(null);
  const [enrichError, setEnrichError] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // How the FOLDERS themselves are piled up. Every option is derived from what
  // is already in each folder, so none of it needs a column or a migration —
  // and none of it can drift out of date with the leads it describes.
  const [folderGroupBy, setFolderGroupBy] = useState<FolderGroupBy>("none");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchLeadSummaries().then((s) => {
      if (cancelled) return;
      if (s) {
        summaryMemory = s;
        setSummaries(s);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchLeadSummaries, reloadTick]);

  // A folder's full rows, fetched every time it is opened. Rows already on hand
  // from an earlier visit show at once while the fresh ones come in behind.
  useEffect(() => {
    if (!openFolderId) return;
    let cancelled = false;
    fetchCompanies(openFolderId).then((rows) => {
      if (cancelled) return;
      // fetchCompanies answers [] when the read fails. Never let that wipe rows
      // that are already on screen.
      setOpened((o) => (rows.length === 0 && o[openFolderId] ? o : { ...o, [openFolderId]: rows }));
    });
    return () => {
      cancelled = true;
    };
  }, [openFolderId, fetchCompanies]);

  if (summaries === null && loadFailed) {
    return (
      <LoadFailed
        onRetry={() => {
          setLoadFailed(false);
          setReloadTick((t) => t + 1);
        }}
      />
    );
  }
  if (summaries === null || foldersLoading) return <ListsSkeleton />;

  // LEADS only, and only those whose folder still exists. A folder deleted a
  // moment ago must not keep counting toward the headline while the summaries
  // refresh behind it.
  const folderIds = new Set(folders.map((f) => f.id));
  const leads = summaries.filter((s) => s.searchId && folderIds.has(s.searchId));
  const counts = new Map<string, number>();
  const signals = new Map<string, number>();
  for (const c of leads) {
    if (!c.searchId) continue;
    counts.set(c.searchId, (counts.get(c.searchId) ?? 0) + 1);
    if (c.hasSignal) signals.set(c.searchId, (signals.get(c.searchId) ?? 0) + 1);
  }
  // Folders that actually contributed a lead, newest first. An empty folder is
  // a dead card.
  const contributing = folders.filter((f) => counts.has(f.id));
  const leadCount = leads.length;
  // The same company sits in every list it was found in. These are the rows a
  // combined export folds away, so the page can say so instead of letting 102
  // leads and a 97-row spreadsheet look like a lost-data bug.
  const duplicateLeads = countDuplicates(leads);
  const uniqueLeadCount = leadCount - duplicateLeads;
  /** Which list each lead came from, so a combined export can say. */
  const folderName = new Map(folders.map((f) => [f.id, folderTitle(f.label)]));
  const openFolder = contributing.find((f) => f.id === openFolderId) ?? null;

  /**
   * Every lead in full, for a combined export. Fetched once and reused for a
   * minute; the button asks for it as the pointer arrives so that, by the click,
   * it is usually already here.
   */
  function allLeadsRows(): Promise<Company[]> {
    const memo = allLeadsRef.current;
    if (memo && Date.now() - memo.at < ALL_LEADS_TTL_MS) return memo.rows;
    const rows = fetchAllLeads();
    allLeadsRef.current = { at: Date.now(), rows };
    // A failed read must not be remembered, or every later click re-throws it.
    rows.catch(() => {
      if (allLeadsRef.current?.rows === rows) allLeadsRef.current = null;
    });
    return rows;
  }

  async function downloadAll() {
    setError("");
    setCsvBusy(true);
    try {
      const all = (await allLeadsRows()).filter((c) => c.searchId && folderIds.has(c.searchId));
      // His notes and his own grade travel with the rows, so the CSV and the
      // spreadsheet say the same thing.
      // ONE ROW PER COMPANY. The same company sits in every list it was found
      // in, so combining the lists produced duplicates Jonathan then had to
      // clean by hand. The best row is kept, no address or note is lost, and
      // the other lists are named.
      downloadCompaniesCsv(
        dedupeCompanies(withMarks(all, (c) => folderName.get(c.searchId ?? "") ?? "")).rows,
        "all-leads"
      );
    } catch (e) {
      setError((e as Error).message || "Could not build that file.");
    } finally {
      setCsvBusy(false);
    }
  }

  const leadsByFolder = new Map<string, LeadSummary[]>();
  for (const c of leads) {
    if (!c.searchId) continue;
    const list = leadsByFolder.get(c.searchId) ?? [];
    list.push(c);
    leadsByFolder.set(c.searchId, list);
  }

  const folderGroups: { key: string; folders: SearchFolder[] }[] = [];
  {
    const m = new Map<string, SearchFolder[]>();
    for (const f of contributing) {
      const key =
        folderGroupBy === "none"
          ? ""
          : folderBucket(f, leadsByFolder.get(f.id) ?? [], folderGroupBy);
      const list = m.get(key) ?? [];
      list.push(f);
      m.set(key, list);
    }
    // Biggest pile first — with one exception. "By outcome" has a natural
    // ranking that size would scramble, and the folders that found signals are
    // the ones worth seeing first however few of them there are.
    const order = [...m.entries()];
    if (folderGroupBy === "outcome") {
      const rank = ["Found signals", "Fit-only leads", "Nothing found"];
      order.sort((a, b) => rank.indexOf(a[0]) - rank.indexOf(b[0]));
    } else {
      order.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    }
    for (const [key, list] of order) folderGroups.push({ key, folders: list });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setError("");
    // Everything that belongs to the folder disappears with it, in the same
    // frame. Waiting for the request to return before clearing these left the
    // folder's rows on screen under a heading that had already gone.
    if (openFolderId === target.id) setOpenFolderId(null);
    const remaining = (summaries ?? []).filter((c) => c.searchId !== target.id);
    summaryMemory = remaining;
    setSummaries(remaining);
    setOpened((o) => Object.fromEntries(Object.entries(o).filter(([id]) => id !== target.id)));
    allLeadsRef.current = null;
    try {
      await deleteSearch(target.id);
    } catch (e) {
      setError((e as Error).message || "Could not delete that folder.");
    }
  }

  async function confirmEnrich() {
    if (!openFolderId || !pendingPick) return;
    const ids = pendingPick;
    setPendingPick(null);
    try {
      await startEnrichment(openFolderId, undefined, ids);
      // Pull this folder's rows back so the picked companies show their new
      // contact state without a manual refresh. The combined export's rows are
      // out of date now too.
      allLeadsRef.current = null;
      const fresh = await fetchCompanies(openFolderId);
      setOpened((o) => ({ ...o, [openFolderId]: fresh }));
    } catch (e) {
      setEnrichError((e as Error).message || "Could not start the lookup.");
    }
  }

  const pickedRejected =
    pendingPick && openFolderId
      ? (opened[openFolderId] ?? []).filter(
          (c) => pendingPick.includes(c.id) && c.status === "rejected"
        ).length
      : 0;

  const enrichDialog = (
    <ConfirmDialog
      open={pendingPick !== null}
      title="Look up these emails?"
      confirmLabel="Yes, look them up"
      cancelLabel="No, go back"
      onConfirm={confirmEnrich}
      onCancel={() => setPendingPick(null)}
      body={
        pendingPick && (
          <>
            <p>
              Searching for a contact at{" "}
              <strong className="font-semibold text-gh-ink">
                {pendingPick.length} {pendingPick.length === 1 ? "company" : "companies"}
              </strong>{" "}
              you picked.
            </p>
            {pickedRejected > 0 && (
              <p className="mt-2">
                <strong className="font-semibold text-gh-ink">
                  {pickedRejected} of them {pickedRejected === 1 ? "was" : "were"} marked not a fit.
                </strong>{" "}
                They will be looked up anyway.
              </p>
            )}
            <p className="mt-2">
              Costs up to{" "}
              <strong className="font-semibold text-gh-ink">
                ${(pendingPick.length * ENRICH_CEILING_PER_COMPANY_USD).toFixed(2)}
              </strong>
              , charged only for the addresses actually found.
            </p>
          </>
        )
      }
    />
  );

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
    // Undefined until this folder's rows have arrived. The header and its count
    // are drawn at once from what the front door already knows.
    const rows = opened[openFolder.id];
    const visible = rows ?? [];
    // WHAT THE PAGE SHOWS, AND NO MORE. The "Not a fit" tab leaves out the
    // companies that were a different KIND of business (funeral homes,
    // newspapers, directories), and the export used to carry them anyway: the tab
    // read 11 while the button offered 17. A hidden row is hidden everywhere or
    // nowhere, so the file is built from the same rows, as it is on the list
    // page.
    const exportable = visible.filter(
      (c) => c.status !== "rejected" || !isWrongKindOfBusiness(c.rejectionReason)
    );
    // The CSV carries the cut companies too, labelled by the `verdict` column.
    // The button says so, because a file three times the size of the screen is
    // a surprise worth spending eight words on.
    const visibleLeads = rows
      ? rows.filter((c) => c.status === "qualified").length
      : (counts.get(openFolder.id) ?? 0);
    const selected = visible.find((c) => c.id === selectedId) ?? null;

    return (
      <div className="mx-auto max-w-7xl space-y-6">
        {deleteDialog}
        {enrichDialog}

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
                {folderTitle(openFolder.label)}
              </h1>
              <p className="mt-1 text-sm text-gh-ink-secondary">
                {visibleLeads} lead{visibleLeads === 1 ? "" : "s"} · scraped{" "}
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
                // His notes and his own grade go with the rows, as they do from the
                // list page and the combined export.
                onClick={() => downloadCompaniesCsv(withMarks(exportable), slugify(folderTitle(openFolder.label)))}
                disabled={exportable.length === 0}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gh-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <DownloadIcon className="h-4 w-4" />
                Download{rows ? ` ${exportable.length}` : ""}
                {rows && visibleLeads !== exportable.length && (
                  <span className="font-normal text-white/60">
                    ({visibleLeads} leads + {exportable.length - visibleLeads} not a fit)
                  </span>
                )}
              </button>
              <SheetsButton companies={withMarks(exportable)} />
            </div>
          </div>
        </div>

        {error && <p className="text-xs font-medium text-gh-critical">{error}</p>}

        {enrichError && (
          <p className="rounded-lg border border-gh-critical/30 bg-gh-critical/5 px-3 py-2 text-xs text-gh-critical">
            {enrichError}
          </p>
        )}

        {rows ? (
          <CompaniesTable
            key={openFolder.id}
            companies={visible}
            onRowClick={(c) => setSelectedId(c.id)}
            defaultView="table"
            onEnrichSelected={(ids) => {
              if (ids.length === 0) return;
              setEnrichError("");
              setPendingPick(ids);
            }}
            enrichBusy={openFolder.enrichmentStatus === "running"}
          />
        ) : (
          <RowsSkeleton />
        )}

        {/* Under the leads, on both folder routes. This page and
            /dashboard/lists/[id] are two different renders of the same thing,
            and the section was only on one of them — which is why it did not
            appear when opened from here. */}
        <WhyTheseAreNot searchId={openFolder.id} count={openFolder.rejectedCount} />

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
          <h1 className="font-display text-2xl font-semibold text-gh-ink">Lead Lists</h1>
        </div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gh-ink-secondary">
            {contributing.length === 0
              ? "No leads yet."
              : `${contributing.length} list${contributing.length === 1 ? "" : "s"}, ${leadCount} lead${leadCount === 1 ? "" : "s"}${
                  duplicateLeads > 0
                    ? ` (${uniqueLeadCount} different ${uniqueLeadCount === 1 ? "company" : "companies"}; ${duplicateLeads} ${duplicateLeads === 1 ? "is" : "are"} in more than one list)`
                    : ""
                }. Open one to see inside.`}
          </p>
          <div className="flex items-center gap-2">
            {/* ONE FILE FOR EVERY LIST.
                Each folder already exports its own, which is right when you
                are working one search. It is the wrong shape when the question
                is "who have I got", because that answer is spread across eight
                files with eight headers. The folder name rides along as a
                column so the combined sheet can still be grouped back. */}
            {leads.length > 0 && (
              <button
                type="button"
                onClick={downloadAll}
                onPointerEnter={() => void allLeadsRows().catch(() => {})}
                onFocus={() => void allLeadsRows().catch(() => {})}
                disabled={csvBusy}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-gh-border bg-gh-surface px-3 py-1.5 text-xs font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-wait disabled:opacity-60"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                {csvBusy ? "Preparing…" : `CSV all ${uniqueLeadCount}`}
              </button>
            )}
            {leads.length > 0 && <XlsxButton count={uniqueLeadCount} />}
            {contributing.length > 0 && (
              <div className="flex shrink-0 rounded-lg border border-gh-border bg-gh-surface-sunken p-0.5">
                {(["cards", "list"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFolderView(k)}
                    aria-pressed={folderView === k}
                    className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      folderView === k
                        ? "bg-gh-surface text-gh-ink shadow-sm"
                        : "text-gh-ink-muted hover:text-gh-ink"
                    }`}
                  >
                    {k === "cards" ? "Cards" : "List"}
                  </button>
                ))}
              </div>
            )}
          {contributing.length > 1 && (
            <select
              value={folderGroupBy}
              onChange={(e) => setFolderGroupBy(e.target.value as FolderGroupBy)}
              aria-label="Group folders by"
              className="shrink-0 rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-1.5 text-xs font-medium text-gh-ink-secondary focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
            >
              {FOLDER_GROUPS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          </div>
        </div>
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
        <div className="space-y-6">
          {folderGroups.map((g) => (
            <section key={g.key}>
              {folderGroupBy !== "none" && (
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gh-ink-secondary">
                    {g.key}
                  </h2>
                  <span className="tabular text-[11px] text-gh-ink-muted">
                    {g.folders.length} folder{g.folders.length === 1 ? "" : "s"} ·{" "}
                    {g.folders.reduce((n, f) => n + (counts.get(f.id) ?? 0), 0)} leads
                  </span>
                </div>
              )}
              <div
                className={
                  folderView === "cards"
                    ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    : "divide-y divide-gh-border overflow-hidden rounded-xl border border-gh-border bg-gh-surface"
                }
              >
                {g.folders.map((f, i) => (
                  <FolderTile
                    key={f.id}
                    folder={f}
                    index={i}
                    view={folderView}
                    leads={counts.get(f.id) ?? 0}
                    signals={signals.get(f.id) ?? 0}
                    renaming={renaming === f.id}
                    draftName={draftName}
                    onDraftChange={setDraftName}
                    onOpen={() => setOpenFolderId(f.id)}
                    onStartRename={() => {
                      setRenaming(f.id);
                      setDraftName(f.label);
                    }}
                    onCommitRename={async () => {
                      const next = draftName.trim();
                      setRenaming(null);
                      if (!next || next === f.label) return;
                      setError("");
                      try {
                        await renameSearch(f.id, next);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                    onCancelRename={() => setRenaming(null)}
                    onDelete={() => setPendingDelete(f)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** The front door while the counts come in: the same shape, so nothing jumps when they land. */
function ListsSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-6" aria-busy="true" aria-label="Loading your lead lists">
      <div>
        <div className="h-8 w-40 rounded-lg bg-gh-surface-sunken motion-safe:animate-pulse" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-gh-surface-sunken motion-safe:animate-pulse" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[132px] rounded-xl border border-gh-border bg-gh-surface motion-safe:animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

/** A folder's rows while they are being fetched. */
function RowsSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading this list">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-14 rounded-xl border border-gh-border bg-gh-surface motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="font-display text-lg font-semibold text-gh-ink">Could not load your lead lists</p>
      <p className="mt-2 text-sm text-gh-ink-secondary">
        Nothing is lost. This is usually a dropped connection.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex cursor-pointer items-center rounded-lg bg-gh-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
      >
        Try again
      </button>
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
 * Jonathan is in LA, and an evening search lands squarely in that window, so
 * this has to be the viewer's day.
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

/**
 * One folder.
 *
 * Rename is inline rather than behind a dialog: the generated label
 * ("Landscaping companies in Texas") is a decent default and a poor name for
 * work, and once there are a dozen folders the useful name is his — "Houston
 * round 2", "for the Tuesday call". A rename people have to go and find is a
 * rename nobody does.
 *
 * Enter commits, Escape abandons, blur commits. Blur-commits because the
 * common way to finish typing is to click elsewhere, and losing the edit at
 * that moment is the single most annoying way an inline field can behave.
 */
function FolderTile({
  folder,
  index,
  leads,
  signals,
  renaming,
  draftName,
  onDraftChange,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  view = "cards",
}: {
  folder: SearchFolder;
  index: number;
  leads: number;
  signals: number;
  renaming: boolean;
  draftName: string;
  onDraftChange: (v: string) => void;
  onOpen: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  view?: "cards" | "list";
}) {
  // ONE ROW PER FOLDER. Same data, same actions, a third of the height, so
  // nine folders fit on a screen instead of three. The tile earns its space
  // while there are a few; past that it is mostly padding.
  if (view === "list") {
    return (
      <div className="group relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gh-surface-sunken">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
          <FolderIcon className="h-3.5 w-3.5" />
        </span>
        {renaming ? (
          <input
            autoFocus
            autoComplete="off"
            value={draftName}
            onChange={(e) => onDraftChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename();
              if (e.key === "Escape") onCancelRename();
            }}
            maxLength={120}
            aria-label="Folder name"
            className="min-w-0 flex-1 rounded-lg border border-gh-sky bg-gh-surface-sunken px-2 py-1 text-base font-semibold text-gh-ink focus:outline-none focus:ring-2 focus:ring-gh-sky/30 sm:text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            <span className="block truncate text-sm font-semibold text-gh-ink group-hover:text-gh-navy">
              {folderTitle(folder.label)}
            </span>
            <span className="block text-[11px] text-gh-ink-muted">
              scraped {dayLabel(dayKey(folder.createdAt))}
            </span>
          </button>
        )}
        <span className="tabular shrink-0 text-right text-xs text-gh-ink-secondary">
          <strong className="font-display text-sm font-semibold text-gh-ink">{leads}</strong> leads
          {signals > 0 && (
            <>
              {" · "}
              <strong className="font-display text-sm font-semibold text-gh-navy">{signals}</strong>{" "}
              signals
            </>
          )}
        </span>
        {!renaming && (
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onStartRename}
              aria-label={`Rename ${folder.label}`}
              title="Rename"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-gh-ink-muted transition-colors hover:bg-gh-surface hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${folder.label}`}
              title="Delete this folder"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-gh-ink-muted transition-colors hover:bg-gh-critical/10 hover:text-gh-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-critical/30"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="fade-up lift group relative rounded-xl border border-gh-border bg-gh-surface hover:border-gh-sky/50"
      style={{ animationDelay: `${Math.min(index, 12) * 50}ms` }}
    >
      {/* THE WHOLE CARD OPENS IT.
          Only the title and the counts row were clickable, which is two thin
          strips inside a tile that lifts on hover and lights its border --
          every visual promise of a click target, kept by about a fifth of its
          surface. The folder icon, the "scraped Today" line and all the
          padding did nothing, so the natural place to aim, the middle of the
          card, was dead.

          An overlay rather than wrapping the card in a button, because the
          rename and delete controls live inside it and a button cannot
          legally contain buttons. Everything interactive sits above this on
          z-10; this fills the gaps between them. Hidden while renaming so it
          cannot swallow clicks meant for the text field. */}
      {!renaming && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${folderTitle(folder.label)}`}
          className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        />
      )}
      <div className="pointer-events-none relative z-10 p-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
          <FolderIcon className="h-4 w-4" />
        </span>

        {renaming ? (
          <input
            autoFocus
            autoComplete="off"
            value={draftName}
            onChange={(e) => onDraftChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename();
              if (e.key === "Escape") onCancelRename();
            }}
            maxLength={120}
            aria-label="Folder name"
            // 16px on mobile, or iOS zooms in on focus and will not zoom back.
            className="pointer-events-auto mt-3 w-full rounded-lg border border-gh-sky bg-gh-surface-sunken px-2 py-1.5 text-base font-semibold text-gh-ink focus:outline-none focus:ring-2 focus:ring-gh-sky/30 sm:text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="pointer-events-auto mt-3 block w-full cursor-pointer pr-16 text-left text-sm font-semibold leading-snug text-gh-ink group-hover:text-gh-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            {folderTitle(folder.label)}
          </button>
        )}

        <p className="mt-0.5 text-[11px] text-gh-ink-muted">
          scraped {dayLabel(dayKey(folder.createdAt))}
        </p>

        <button
          type="button"
          onClick={onOpen}
          className="pointer-events-auto mt-3 flex w-full cursor-pointer items-end gap-4 border-t border-gh-border pt-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          <span>
            <span className="tabular block font-display text-xl font-semibold leading-none text-gh-ink">
              <CountUp value={leads} />
            </span>
            <span className="mt-0.5 block text-[10px] text-gh-ink-muted">leads</span>
          </span>
          {signals > 0 && (
            <span>
              <span className="tabular block font-display text-xl font-semibold leading-none text-gh-navy">
                <CountUp value={signals} />
              </span>
              <span className="mt-0.5 block text-[10px] text-gh-ink-muted">signals</span>
            </span>
          )}
        </button>
      </div>

      {/* Parked in the corner, out of the reading path. Rename first: it is the
          one anyone actually wants, and putting delete alone up here made the
          only per-folder action a destructive one. */}
      {!renaming && (
        <div className="pointer-events-auto absolute right-2 top-2 z-20 flex items-center gap-0.5">
          <button
            type="button"
            onClick={onStartRename}
            aria-label={`Rename ${folder.label}`}
            title="Rename"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-gh-ink-muted transition-colors duration-200 hover:bg-gh-surface-sunken hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            <PencilIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${folder.label}`}
            title="Delete this folder"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-gh-ink-muted transition-colors duration-200 hover:bg-gh-critical/10 hover:text-gh-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-critical/30"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
