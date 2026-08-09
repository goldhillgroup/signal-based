"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Company } from "@/lib/company";
import { SearchFolder, useSearches } from "@/lib/searches-store";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  getSummaryStats,
  getIndustryBreakdown,
  getDailyTrend,
} from "@/lib/stats";
import { INDUSTRY_META } from "@/lib/signal-meta";
import { downloadCompaniesCsv } from "@/lib/csv-export";
import { StatCard } from "./StatCard";
import { SignalTrendChart } from "./SignalTrendChart";
import { BreakdownBars } from "./BreakdownBars";
import { CompaniesTable } from "./CompaniesTable";
import { CompanyDrawer } from "./CompanyDrawer";
import { ArrowLeftIcon, RadarIcon, ZapIcon, InboxIcon, UsersIcon, DownloadIcon } from "./icons";

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
    setConfirmEnrich(false);
    setEnrichError("");
    try {
      await startEnrichment(folder.id);
      setFolder({ ...folder, enrichmentStatus: "running" });
    } catch (e) {
      setEnrichError((e as Error).message || "Could not start enrichment.");
    }
  }

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
  const selected = companies.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <ConfirmDialog
        open={confirmEnrich}
        title="Look up these emails?"
        confirmLabel="Yes, look them up"
        cancelLabel="No, go back"
        onConfirm={handleEnrich}
        onCancel={() => setConfirmEnrich(false)}
        body={
          <>
            <p>
              Searching for a contact at{" "}
              <strong className="font-semibold text-gh-ink">
                {stats.qualified + stats.verify}{" "}
                {stats.qualified + stats.verify === 1 ? "company" : "companies"}
              </strong>{" "}
              with a signal in this folder.
            </p>
            <p className="mt-2">
              Costs up to{" "}
              <strong className="font-semibold text-gh-ink">
                ${((stats.qualified + stats.verify) * 0.05).toFixed(2)}
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
        <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold text-gh-ink">{folder.label}</h1>
            <p className="mt-1 text-sm text-gh-ink-secondary">&ldquo;{folder.query}&rdquo;</p>
            <button
              type="button"
              onClick={() => downloadCompaniesCsv(companies, folder.label)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gh-border bg-gh-surface px-3 py-1.5 text-xs font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              Download as spreadsheet (CSV)
            </button>
          </div>
          <div className="text-right">
            <p className="text-xs text-gh-ink-muted">
              Completed{" "}
              {folder.finishedAt
                ? new Date(folder.finishedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "-"}
            </p>
            {(folder.mode === "signal" ? stats.qualified + stats.verify : stats.accepted) < folder.targetSignals && (
              <p className="mt-0.5 text-xs text-gh-ink-muted">
                {folder.mode === "signal" ? stats.qualified + stats.verify : stats.accepted} of {folder.targetSignals} requested
                {folder.candidatesPoolExhausted ? ", pool exhausted" : ""}
              </p>
            )}
            {folder.errorMessage && (
              <p className="mt-0.5 max-w-xs text-xs text-gh-ink-muted">{folder.errorMessage}</p>
            )}
            {/* What this run actually cost, metered call by call, see
                lib/pipeline/cost-tracker.ts. Estimates, and labeled as such. */}
            {folder.costEstimateUsd !== null && folder.costEstimateUsd > 0 && (
              <p className="tabular mt-0.5 text-xs text-gh-ink-muted">
                ~${folder.costEstimateUsd.toFixed(2)} est.
                {folder.costBreakdown ? ` (${folder.costBreakdown})` : ""}
              </p>
            )}
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
              `Find and verify emails for ${stats.accepted} accepted companies, separate step, runs on demand.`}
            {folder.enrichmentStatus === "running" &&
              `Looking up contacts, ${stats.contactsFound} found, ${stats.contactsVerified} verified so far…`}
            {folder.enrichmentStatus === "complete" &&
              `Done, ${stats.contactsFound} contact${stats.contactsFound === 1 ? "" : "s"} found, ${stats.contactsVerified} verified.`}
            {folder.enrichmentStatus === "failed" && (folder.enrichmentError ?? "Enrichment failed. Try again.")}
          </p>
          {enrichError && <p className="mt-0.5 text-xs font-medium text-gh-critical">{enrichError}</p>}
        </div>
        <button
          type="button"
          onClick={() => setConfirmEnrich(true)}
          disabled={folder.enrichmentStatus === "running"}
          className="shrink-0 rounded-lg bg-gh-navy px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {folder.enrichmentStatus === "running"
            ? "Enriching…"
            : folder.enrichmentStatus === "complete"
              ? "Re-run enrichment"
              : folder.enrichmentStatus === "failed"
                ? "Retry enrichment"
                : "Enrich contacts"}
        </button>
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
            <p className="text-xs text-gh-ink-muted">Daily, last {trend.length || 0} days</p>
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
            <p className="text-xs text-gh-ink-muted">Landscaping vs. home builders</p>
          </div>
          <BreakdownBars rows={industryRows} />
        </div>
      </div>

      <CompaniesTable companies={companies} onRowClick={(c) => setSelectedId(c.id)} />

      <CompanyDrawer company={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
