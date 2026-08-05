"use client";

import { useMemo, useState } from "react";
import { Company } from "@/lib/mock-companies";
import { INDUSTRY_META } from "@/lib/signal-meta";
import type { Industry } from "@/lib/supabase/types";
import { formatRelativeDate } from "@/lib/stats";
import {
  ConfidenceBadge,
  StatusBadge,
  FindStatusBadge,
  VerificationBadge,
  IndustryChip,
} from "./badges";
import { SearchIcon } from "./icons";

type Tab = "all" | "qualified" | "verify" | "rejected";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "qualified", label: "Qualified" },
  { key: "verify", label: "Verify" },
  { key: "rejected", label: "Rejected" },
];

function matchesTab(c: Company, tab: Tab) {
  if (tab === "all") return true;
  if (tab === "qualified") return c.status === "qualified" && c.confidence !== "verify";
  if (tab === "verify") return c.status === "qualified" && c.confidence === "verify";
  if (tab === "rejected") return c.status === "rejected";
  return true;
}

export function CompaniesTable({
  companies,
  onRowClick,
}: {
  companies: Company[];
  onRowClick: (company: Company) => void;
}) {
  // Default to the first tab that actually has results — landing on an
  // empty "Qualified" tab reads as broken when a folder is all rejects.
  const [tab, setTab] = useState<Tab>(() => {
    const priority: Tab[] = ["qualified", "verify", "rejected", "all"];
    return priority.find((t) => companies.some((c) => matchesTab(c, t))) ?? "all";
  });
  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState<Industry | "all">("all");

  const counts = useMemo(
    () =>
      TABS.reduce<Record<Tab, number>>((acc, t) => {
        acc[t.key] = companies.filter((c) => matchesTab(c, t.key)).length;
        return acc;
      }, {} as Record<Tab, number>),
    [companies]
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return companies
      .filter((c) => matchesTab(c, tab))
      .filter((c) => (industry === "all" ? true : c.industry === industry))
      .filter((c) =>
        query === ""
          ? true
          : c.name.toLowerCase().includes(query) ||
            (c.founderName ?? "").toLowerCase().includes(query) ||
            (c.nextGenName ?? "").toLowerCase().includes(query) ||
            c.city.toLowerCase().includes(query)
      )
      .sort((a, b) => b.lastCrawledAt.localeCompare(a.lastCrawledAt));
  }, [companies, tab, industry, q]);

  return (
    <div className="rounded-xl border border-gh-border bg-gh-surface">
      <div className="flex flex-wrap items-center gap-1 border-b border-gh-border p-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.key
                ? "bg-gh-navy text-white"
                : "text-gh-ink-secondary hover:bg-gh-surface-sunken"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 tabular ${tab === t.key ? "text-white/60" : "text-gh-ink-muted"}`}>
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-b border-gh-border p-4 sm:flex-row sm:items-center">
        <div className="relative max-w-xs flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gh-ink-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="text"
            placeholder="Filter by company, name, city…"
            className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken py-1.5 pl-8 pr-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
          />
        </div>
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value as Industry | "all")}
          className="rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-1.5 text-xs font-medium text-gh-ink-secondary focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20 sm:ml-auto"
        >
          <option value="all">All industries</option>
          <option value="landscaping">{INDUSTRY_META.landscaping.label}</option>
          <option value="home_builder">{INDUSTRY_META.home_builder.label}</option>
        </select>
      </div>

      <p className="px-4 pt-3 text-xs text-gh-ink-muted">
        Showing <span className="font-semibold text-gh-ink-secondary">{filtered.length}</span> of{" "}
        {companies.length} tracked companies
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-gh-border text-left text-xs font-semibold uppercase tracking-wide text-gh-ink-muted">
              <th className="px-4 py-3 font-semibold">Company</th>
              <th className="px-4 py-3 font-semibold">Industry</th>
              <th className="px-4 py-3 font-semibold">Confidence / status</th>
              <th className="px-4 py-3 font-semibold">Next-gen contact</th>
              <th className="px-4 py-3 font-semibold">Verification</th>
              <th className="px-4 py-3 font-semibold">Last checked</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                onClick={() => onRowClick(c)}
                className="cursor-pointer border-b border-gh-border last:border-0 hover:bg-gh-surface-sunken"
              >
                <td className="px-4 py-3">
                  <p className="font-semibold text-gh-ink">{c.name}</p>
                  <p className="text-xs text-gh-ink-muted">
                    {c.city}, {c.state} &middot; {c.revenueBand}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <IndustryChip industry={c.industry} />
                </td>
                <td className="px-4 py-3">
                  {c.status === "rejected" ? (
                    <StatusBadge status="rejected" />
                  ) : c.status === "pending" ? (
                    <StatusBadge status="pending" />
                  ) : c.confidence ? (
                    <ConfidenceBadge confidence={c.confidence} />
                  ) : (
                    <StatusBadge status="pending" />
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.contact ? (
                    <FindStatusBadge status={c.contact.findStatus} />
                  ) : (
                    <span className="text-xs text-gh-ink-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.contact?.findStatus === "found" ? (
                    <VerificationBadge status={c.contact.verificationStatus} />
                  ) : (
                    <span className="text-xs text-gh-ink-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gh-ink-secondary">
                  {formatRelativeDate(c.lastCrawledAt)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-gh-ink-muted">
                  No companies match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
