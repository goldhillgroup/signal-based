"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isWrongKindOfBusiness } from "@/lib/pipeline/recheck-policy";
import Link from "next/link";
import { Company } from "@/lib/company";
import { SearchFolder, useSearches } from "@/lib/searches-store";
import { ConfirmDialog } from "./ConfirmDialog";
import { EnrichProgress } from "./EnrichProgress";
import { WhyTheseAreNot } from "./WhyTheseAreNot";
import {
  getSummaryStats,
  getIndustryBreakdown,
  getDailyTrend,
} from "@/lib/stats";
import { INDUSTRY_META } from "@/lib/signal-meta";
import { downloadCompaniesCsv } from "@/lib/csv-export";
import { StatCard } from "./StatCard";
import { folderTitle } from "@/lib/folder-title";
import { SignalTrendChart } from "./SignalTrendChart";
import { BreakdownBars } from "./BreakdownBars";
import { CompaniesTable } from "./CompaniesTable";
import { CompanyDrawer } from "./CompanyDrawer";
import { ArrowLeftIcon, RadarIcon, ZapIcon, InboxIcon, UsersIcon, DownloadIcon } from "./icons";
import { ENRICH_CEILING_PER_COMPANY_USD } from "@/lib/pipeline/pricing";
import { enrichScopesFor } from "@/lib/enrich-scopes";
import { EnrichScopeDialog } from "./EnrichScopeDialog";
import { SheetsButton } from "./SheetsButton";

export function FolderView({ folder: folderProp, companies: companiesProp }: { folder: SearchFolder; companies: Company[] }) {
  const { fetchFolder, fetchCompanies, startEnrichment } = useSearches();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Two-step flow: discovery is already done by the time this renders (see
  // app/dashboard/lists/[id]/page.tsx), but enrichment is a separate,
  // button-triggered step with its own lifecycle — local state + polling so
  // this component can reflect that step live without the parent page
  // needing to know enrichment exists at all.
  const [folder, setFolder] = useState(folderProp);
  const [companies, setCompanies] = useState(companiesProp);
  const [enrichError, setEnrichError] = useState("");
  const [confirmEnrich, setConfirmEnrich] = useState(false);
  const [choosingScope, setChoosingScope] = useState(false);
  /** Explicit company ids awaiting confirmation. null = the folder-wide button. */
  const [pendingPick, setPendingPick] = useState<string[] | null>(null);
  // Watch the run the way the search does. The Enrichment page has had this
  // since it was built; the in-folder button never did — pressing it here
  // greyed out to "Enriching…" and gave no count, no percentage and no way to
  // tell a working pass from a dead one. Same job, same server-side run, so it
  // gets the same dialog.
  const [watchingEnrich, setWatchingEnrich] = useState(false);
  const stopPollRef = useRef(false);

  // Reset local override state when the parent hands us a different search
  // (e.g. navigating from one folder's results to another) — adjusted
  // during render rather than in an effect, per React's own guidance for
  // "state that needs to change when a prop changes."
  //
  // Tracks the companies ARRAY IDENTITY as well as the folder id. Keying on
  // the id alone meant a late-arriving companies array for the SAME folder
  // was silently dropped — the parent's fetch resolves after the first
  // render, so "same folder, now with data" is the normal case, not an edge
  // one. The parent now sets both together, and this is the second guard.
  const [trackedFolderId, setTrackedFolderId] = useState(folderProp.id);
  const [trackedCompanies, setTrackedCompanies] = useState(companiesProp);
  if (folderProp.id !== trackedFolderId || companiesProp !== trackedCompanies) {
    setTrackedFolderId(folderProp.id);
    setTrackedCompanies(companiesProp);
    setFolder(folderProp);
    setCompanies(companiesProp);
  }

  useEffect(() => {
    if (folder.enrichmentStatus !== "running") return;
    stopPollRef.current = false;
    (async function poll() {
      while (!stopPollRef.current) {
        await new Promise((r) => setTimeout(r, 1200));
        const f = await fetchFolder(folder.id);
        if (!f || stopPollRef.current) return;
        setFolder(f);
        if (f.enrichmentStatus !== "running") {
          const c = await fetchCompanies(folder.id);
          if (!stopPollRef.current) setCompanies(c);
          return;
        }
      }
    })();
    return () => {
      stopPollRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder.id, folder.enrichmentStatus]);

  // Same yes/no as the Enrichment page. This button spends the same money on
  // the same vendor, so it cannot be the one place that just does it.
  async function handleEnrich() {
    const ids = pendingPick;
    setConfirmEnrich(false);
    setPendingPick(null);
    setEnrichError("");
    try {
      // An explicit pick overrides the scope server-side, and is the only path
      // that can reach a company the pipeline rejected.
      await startEnrichment(folder.id, undefined, ids ?? undefined);
      setFolder({ ...folder, enrichmentStatus: "running" });
      setWatchingEnrich(true);
    } catch (e) {
      setEnrichError((e as Error).message || "Could not start enrichment.");
    }
  }


  // Everything on the page: the leads plus the cuts worth arguing with.


  // Excludes the ones hidden from the "Not a fit" tab as a different kind


  // of business, so an export cannot contain what the UI refuses to show.


  // Same three choices as everywhere else. See lib/enrich-scopes — three
  // surfaces each had their own idea of this, and two of them decided for you.
  const enrichScopes = enrichScopesFor(companies);

  const exportable = companies.filter(


    (c) => c.status !== "rejected" || !isWrongKindOfBusiness(c.rejectionReason)


  );



  const stats = useMemo(() => getSummaryStats(companies), [companies]);
  const industryRows = useMemo(
    () =>
      getIndustryBreakdown(companies).map((r) => ({
        key: r.key,
        label: INDUSTRY_META[r.key].label,
        color: INDUSTRY_META[r.key].color,
        count: r.count,
        pct: r.pct,
      })),
    [companies]
  );
  const trend = useMemo(() => getDailyTrend(companies), [companies]);

  /** How many the pending action will actually look up — a pick, or the signals. */
  const enrichCount = pendingPick ? pendingPick.length : stats.qualified + stats.verify;
  const rejectedInPick = pendingPick
    ? companies.filter((c) => pendingPick.includes(c.id) && c.status === "rejected").length
    : 0;
  const selected = companies.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {watchingEnrich && (
        <EnrichProgress
          folder={folder}
          target={stats.qualified + stats.verify}
          onDismiss={() => setWatchingEnrich(false)}
        />
      )}

      <EnrichScopeDialog
        key={folder.id}
        open={choosingScope}
        folderLabel={folder.label}
        scopes={enrichScopes}
        onPick={(ids) => {
          setChoosingScope(false);
          setPendingPick(ids);
          setConfirmEnrich(true);
        }}
        onCancel={() => setChoosingScope(false)}
      />

      <ConfirmDialog
        open={confirmEnrich}
        title="Look up these emails?"
        confirmLabel="Yes, look them up"
        cancelLabel="No, go back"
        onConfirm={handleEnrich}
        onCancel={() => {
          setConfirmEnrich(false);
          // Clearing the pick is the whole point. `confirmEnrich` and
          // `pendingPick` are two pieces of state for one dialog, and leaving
          // the pick armed meant the next press of the folder-wide "Enrich
          // contacts" button re-opened on a selection the user had already
          // rejected — spending on companies they had backed out of.
          setPendingPick(null);
        }}
        body={
          <>
            <p>
              Searching for a contact at{" "}
              <strong className="font-semibold text-gh-ink">
                {enrichCount} {enrichCount === 1 ? "company" : "companies"}
              </strong>{" "}
              {pendingPick ? "you picked." : "with a signal in this folder."}
            </p>
            {/* Named explicitly when some of the picks were cut companies. The
                dialog is the last point before money is spent, and "you are
                about to buy an address for a company your own test threw out"
                is exactly the kind of thing it exists to say out loud. */}
            {pendingPick && rejectedInPick > 0 && (
              <p className="mt-2">
                <strong className="font-semibold text-gh-ink">
                  {rejectedInPick} of them {rejectedInPick === 1 ? "was" : "were"} marked not a fit.
                </strong>{" "}
                They will be looked up anyway.
              </p>
            )}
            <p className="mt-2">
              Costs up to{" "}
              <strong className="font-semibold text-gh-ink">
                ${(enrichCount * ENRICH_CEILING_PER_COMPANY_USD).toFixed(2)}
              </strong>
              , charged only for the addresses actually found.
            </p>
          </>
        }
      />

      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gh-ink-muted transition-colors hover:text-gh-ink"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Your lists
        </Link>
        <div className="mt-2">
          <div>
            {/* THE SAME TWELVE STATES, TWICE.
                The label IS the query for every search run from the form, so
                printing the query underneath restated the heading word for
                word: three lines of title, then the identical three lines in
                quotes. Only the tail differs, the refinement the user typed,
                and that is the one part worth reading.

                So: heading clamped to two lines, and below it only whatever
                the query adds. When the query is not an extension of the label
                (older rows, renamed folders) the whole thing still shows. */}
            <h1
              className="font-display text-2xl font-semibold text-gh-ink"
              title={folder.label}
            >
              {folderTitle(folder.label)}
            </h1>
            {/* THE FULL QUERY, under a heading that is now a name.
                While the heading WAS the query this line repeated it word for
                word, so it was cut back to just the tail. The heading is a
                short title now, so the states belong here again: said once,
                in the place where a caption belongs. */}
            <p className="mt-1 text-sm text-gh-ink-secondary">&ldquo;{folder.query}&rdquo;</p>
            {/* ONE LINE, LEFT-ALIGNED, UNDER THE TITLE.
                This was a right-aligned column opposite the heading, and at
                any real width it set four ragged lines against the title's
                two: "Completed Aug 16, 11:26" / "PM" / "ran out of time
                before it could look for more" / "companies". Right-aligned
                prose wraps to a ragged LEFT edge, so every line started in a
                different place and the eye had nothing to follow. None of it
                is more than a caption, so it reads as a caption: one row,
                dot-separated, wrapping the way a sentence does. */}
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gh-ink-muted">
              <span>
                Completed{" "}
                {folder.finishedAt
                  ? new Date(folder.finishedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "-"}
              </span>
              {folder.costEstimateUsd !== null && folder.costEstimateUsd > 0 && (
                <>
                  <span aria-hidden>·</span>
                  {/* "27 classify/disprove · 16 extract · 5 searches · 6 SERP
                      pages · 5 renders · 5 map places" is vendor telemetry. It
                      answers "why did this cost 9x the last one", asked rarely,
                      so it moves to the hover and the line keeps the number. */}
                  <span className="tabular cursor-help" title={folder.costBreakdown ?? undefined}>
                    ~${folder.costEstimateUsd.toFixed(2)} est.
                  </span>
                </>
              )}
              {(folder.mode === "signal" ? stats.qualified + stats.verify : stats.accepted) <
                folder.targetSignals && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {folder.mode === "signal" ? stats.qualified + stats.verify : stats.accepted} of{" "}
                    {folder.targetSignals} requested
                    {folder.candidatesPoolExhausted ? ", pool exhausted" : ""}
                  </span>
                </>
              )}
              {folder.errorMessage && (
                <>
                  <span aria-hidden>·</span>
                  <span>{folder.errorMessage}</span>
                </>
              )}
            </p>
            {/* EXPORTS WHAT THE PAGE SHOWS.
                It exported every row, including the ones deliberately hidden
                from the "Not a fit" tab for being a different KIND of business
                — funeral homes, newspapers, obituary sites. So the tab read
                "Not a fit 39" while the button beside it offered "67 not a
                fit", and the sheet Jonathan opened had 28 funeral homes in it
                that the product had already decided were not worth his
                attention. A hidden row is hidden everywhere or nowhere. */}
            <button
              type="button"
              onClick={() => downloadCompaniesCsv(exportable, folderTitle(folder.label))}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gh-border bg-gh-surface px-3 py-1.5 text-xs font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              Download {exportable.length} rows (CSV)
              {exportable.length !== stats.accepted && (
                <span className="font-normal text-gh-ink-muted">
                  {stats.accepted} leads + {exportable.length - stats.accepted} not a fit
                </span>
              )}
            </button>
            {/* Beside the CSV, not instead of it. The download is the archive;
                this is the one you use when a sheet is already open. */}
            <SheetsButton companies={exportable} className="mt-2 ml-2" />
          </div>
        </div>

        {/* Sits directly under the counts on purpose. "Pool exhausted" and
            "a channel was capped" produce the same short number but mean
            opposite things — one says the state is mined out, the other says
            nobody looked. Reading the count without this can be misleading. */}
        {folder.warnings && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-gh-warning/30 bg-gh-warning/10 px-3 py-2">
            <span className="mt-px text-xs">⚠</span>
            <p className="text-xs leading-relaxed text-gh-ink-secondary">{folder.warnings}</p>
          </div>
        )}
      </div>

      {/* Step 2 of the two-step flow, discovery is already done by the time
          this page renders; enrichment only runs when this button is
          clicked, so testing a search's results doesn't automatically spend
          AnymailFinder/MillionVerifier credits. */}
      <div className="flex flex-col items-start gap-2 rounded-xl border border-gh-border bg-gh-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gh-ink">Contact enrichment</p>
          <p className="mt-0.5 text-xs text-gh-ink-secondary">
            {folder.enrichmentStatus === "idle" &&
              `Find and verify emails for the ${stats.qualified + stats.verify} with a signal, separate step, runs on demand. Tick rows below to pick your own.`}
            {folder.enrichmentStatus === "running" &&
              `Looking up contacts, ${stats.contactsFound} found, ${stats.contactsVerified} verified so far…`}
            {folder.enrichmentStatus === "complete" &&
              `Done, ${stats.contactsFound} contact${stats.contactsFound === 1 ? "" : "s"} found, ${stats.contactsVerified} verified.`}
            {folder.enrichmentStatus === "failed" && (folder.enrichmentError ?? "Enrichment failed. Try again.")}
          </p>
          {enrichError && <p className="mt-0.5 text-xs font-medium text-gh-critical">{enrichError}</p>}
        </div>
        {/* The same checklist as everywhere else. This screen had three inline
            buttons, which is three of the seven combinations — and the folder
            page is exactly where you would want pairs AND fits without the
            rejected ones. One button, one dialog, one definition. */}
        {folder.enrichmentStatus === "running" ? (
          <span className="shrink-0 rounded-lg bg-gh-navy px-4 py-2 text-xs font-semibold text-white opacity-50">
            Enriching…
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setChoosingScope(true)}
            className="shrink-0 cursor-pointer rounded-lg bg-gh-navy px-4 py-2 text-xs font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            {folder.enrichmentStatus === "complete"
              ? "Find more emails"
              : folder.enrichmentStatus === "failed"
                ? "Retry finding emails"
                : "Find emails"}
          </button>
        )}
      </div>

      {/* Two numbers about the result, then two about the work behind it.
          "Leads found" is everything this run got; "With a signal" is the
          subset actually backed by a signal. The old qualified / verify-flagged
          / fit-only split was three cards saying one thing three ways. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Leads found"
          value={stats.accepted}
          subtext="Companies this search got you"
          icon={RadarIcon}
          accent="#0b7a0b"
        />
        <StatCard
          label="With a signal"
          value={stats.qualified + stats.verify}
          subtext="Backed by a real signal"
          icon={ZapIcon}
          accent="#9a4a1f"
        />
        {/* Was "Rejected / 67 / Cut, kept, and labeled with a reason". Replaced
            rather than deleted: the run's thoroughness is the useful half of
            that number and the rejects themselves are not, so this says how
            much work was done without putting 67 companies he must not call
            on the same row as the ones he should. */}
        <StatCard
          label="Companies checked"
          value={folder.companiesScanned}
          subtext="Every one read and judged before this list"
          icon={InboxIcon}
          accent="#8892a0"
        />
        <StatCard
          label="Contacts verified"
          value={stats.contactsVerified}
          subtext={`${stats.contactsFound} found of ${stats.accepted} leads`}
          icon={UsersIcon}
          accent="#0fa5e1"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gh-border bg-gh-surface p-5 lg:col-span-2">
          <div className="mb-4">
            <h2 className="font-display text-sm font-semibold text-gh-ink">
              New companies discovered
            </h2>
            <p className="text-xs text-gh-ink-muted">
              {trend.length === 1 ? "One day" : `Daily, last ${trend.length} days`}
            </p>
          </div>
          {trend.length > 0 ? (
            <SignalTrendChart data={trend} />
          ) : (
            <p className="py-10 text-center text-xs text-gh-ink-muted">No data yet.</p>
          )}
        </div>

        <div className="rounded-xl border border-gh-border bg-gh-surface p-5">
          <div className="mb-4">
            <h2 className="font-display text-sm font-semibold text-gh-ink">
              Leads by industry
            </h2>
            {/* Was hardcoded "Landscaping vs. home builders", written when those
                were the only two verticals. There are eight now, so it named
                the wrong ones on most searches. */}
            <p className="text-xs text-gh-ink-muted">
              {industryRows.length === 1 ? industryRows[0].label : `Across ${industryRows.length} trades`}
            </p>
          </div>
          <BreakdownBars rows={industryRows} />
        </div>
      </div>

      <CompaniesTable
        companies={companies}
        onRowClick={(c) => setSelectedId(c.id)}
        onEnrichSelected={(ids) => {
          if (ids.length === 0) return;
          setPendingPick(ids);
          setConfirmEnrich(true);
        }}
        enrichBusy={folder.enrichmentStatus === "running"}
      />

      {/* AFTER the leads, never among them. The proof page argues the
          rejections matter most, and it is right about WHY — they are what
          shows the full test ran rather than a keyword match — but that
          argument only works once he has seen the leads. Mixed in, 39
          rejections simply bury 28 leads. */}
      <WhyTheseAreNot searchId={folder.id} count={folder.rejectedCount} />

      <CompanyDrawer company={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
