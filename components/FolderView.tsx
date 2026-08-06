"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Company } from "@/lib/mock-companies";
import { SearchFolder, useSearches } from "@/lib/searches-store";
import {
  getSummaryStats,
  getIndustryBreakdown,
  getConfidenceBreakdown,
  getDailyTrend,
} from "@/lib/stats";
import { INDUSTRY_META, CONFIDENCE_META } from "@/lib/signal-meta";
import { downloadCompaniesCsv } from "@/lib/csv-export";
import { StatCard } from "./StatCard";
import { SignalTrendChart } from "./SignalTrendChart";
import { BreakdownBars } from "./BreakdownBars";
import { CompaniesTable } from "./CompaniesTable";
import { CompanyDrawer } from "./CompanyDrawer";
import { ArrowLeftIcon, RadarIcon, ZapIcon, InboxIcon, UsersIcon, BuildingIcon, DownloadIcon } from "./icons";

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
  const stopPollRef = useRef(false);

  // Reset local override state when the parent hands us a different search
  // (e.g. navigating from one folder's results to another) — adjusted
  // during render rather than in an effect, per React's own guidance for
  // "state that needs to change when a prop changes."
  const [trackedFolderId, setTrackedFolderId] = useState(folderProp.id);
  if (folderProp.id !== trackedFolderId) {
    setTrackedFolderId(folderProp.id);
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

  async function handleEnrich() {
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
  const confidenceRows = useMemo(
    () =>
      getConfidenceBreakdown(companies).map((r) => ({
        key: r.key,
        label: CONFIDENCE_META[r.key].label,
        color: CONFIDENCE_META[r.key].color,
        count: r.count,
        pct: r.pct,
        description: CONFIDENCE_META[r.key].description,
      })),
    [companies]
  );
  const trend = useMemo(() => getDailyTrend(companies), [companies]);
  const selected = companies.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
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
                : "—"}
            </p>
            {(folder.mode === "signal" ? stats.qualified + stats.verify : stats.accepted) < folder.targetSignals && (
              <p className="mt-0.5 text-xs text-gh-ink-muted">
                {folder.mode === "signal" ? stats.qualified + stats.verify : stats.accepted} of {folder.targetSignals} requested
                {folder.candidatesPoolExhausted ? " — pool exhausted" : ""}
              </p>
            )}
            {folder.errorMessage && (
              <p className="mt-0.5 max-w-xs text-xs text-gh-ink-muted">{folder.errorMessage}</p>
            )}
          </div>
        </div>
      </div>

      {/* Step 2 of the two-step flow — discovery is already done by the time
          this page renders; enrichment only runs when this button is
          clicked, so testing a search's results doesn't automatically spend
          AnymailFinder/MillionVerifier credits. */}
      <div className="flex flex-col items-start gap-2 rounded-xl border border-gh-border bg-gh-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gh-ink">Contact enrichment</p>
          <p className="mt-0.5 text-xs text-gh-ink-secondary">
            {folder.enrichmentStatus === "idle" &&
              `Find and verify emails for ${stats.accepted} accepted companies — separate step, runs on demand.`}
            {folder.enrichmentStatus === "running" &&
              `Looking up contacts — ${stats.contactsFound} found, ${stats.contactsVerified} verified so far…`}
            {folder.enrichmentStatus === "complete" &&
              `Done — ${stats.contactsFound} contact${stats.contactsFound === 1 ? "" : "s"} found, ${stats.contactsVerified} verified.`}
            {folder.enrichmentStatus === "failed" && (folder.enrichmentError ?? "Enrichment failed — try again.")}
          </p>
          {enrichError && <p className="mt-0.5 text-xs font-medium text-gh-critical">{enrichError}</p>}
        </div>
        <button
          type="button"
          onClick={handleEnrich}
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

      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${folder.mode === "signal" ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
        <StatCard
          label="Qualified"
          value={stats.qualified}
          subtext="High or medium confidence"
          icon={RadarIcon}
          accent="#0b7a0b"
        />
        <StatCard
          label="Verify-flagged"
          value={stats.verify}
          subtext="Borderline — needs a human look"
          icon={ZapIcon}
          accent="#9a4a1f"
        />
        {folder.mode !== "signal" && (
          <StatCard
            label="Fit only"
            value={stats.fitOnly}
            subtext="Fits the ICP, no signal found"
            icon={BuildingIcon}
            accent="#3d5a80"
          />
        )}
        <StatCard
          label="Rejected"
          value={stats.rejected}
          subtext="Cut, kept, and labeled with a reason"
          icon={InboxIcon}
          accent="#8892a0"
        />
        <StatCard
          label="Contacts verified"
          value={stats.contactsVerified}
          subtext={`${stats.contactsFound} found of ${stats.accepted} accepted`}
          icon={UsersIcon}
          accent="#0fa5e1"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
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
              Qualified, by industry
            </h2>
            <p className="text-xs text-gh-ink-muted">Landscaping vs. home builders</p>
          </div>
          <BreakdownBars rows={industryRows} />
        </div>

        <div className="rounded-xl border border-gh-border bg-gh-surface p-5">
          <div className="mb-4">
            <h2 className="font-display text-sm font-semibold text-gh-ink">
              Qualified, by confidence
            </h2>
            <p className="text-xs text-gh-ink-muted">Hover a row for what it means</p>
          </div>
          <BreakdownBars rows={confidenceRows} />
        </div>
      </div>

      <CompaniesTable companies={companies} onRowClick={(c) => setSelectedId(c.id)} />

      <CompanyDrawer company={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
