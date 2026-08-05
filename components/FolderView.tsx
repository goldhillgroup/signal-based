"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Company } from "@/lib/mock-companies";
import { SearchFolder } from "@/lib/searches-store";
import {
  getSummaryStats,
  getIndustryBreakdown,
  getConfidenceBreakdown,
  getDailyTrend,
} from "@/lib/stats";
import { INDUSTRY_META, CONFIDENCE_META } from "@/lib/signal-meta";
import { StatCard } from "./StatCard";
import { SignalTrendChart } from "./SignalTrendChart";
import { BreakdownBars } from "./BreakdownBars";
import { CompaniesTable } from "./CompaniesTable";
import { CompanyDrawer } from "./CompanyDrawer";
import { ArrowLeftIcon, RadarIcon, ZapIcon, InboxIcon, UsersIcon } from "./icons";

export function FolderView({ folder, companies }: { folder: SearchFolder; companies: Company[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
          </div>
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
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          subtext={`${stats.contactsFound} found of ${stats.qualified + stats.verify} qualified`}
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
