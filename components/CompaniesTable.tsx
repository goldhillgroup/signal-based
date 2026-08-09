"use client";

import { useMemo, useState } from "react";
import { Company } from "@/lib/company";
import { INDUSTRY_META } from "@/lib/signal-meta";
import type { Industry } from "@/lib/supabase/types";
import { scoreFactors } from "@/lib/lead-signal";
import { SearchIcon } from "./icons";
import { LeadCard } from "./LeadCard";

type Tab = "all" | "qualified" | "verify" | "fit_only";

// No "Rejected" tab. This screen is the lead list, and the companies the
// pipeline cut are not leads — a landscaping search that reads 83 sites and
// keeps 16 was putting 67 rejects in front of him, four sixths of the page
// being businesses he was explicitly told not to call.
//
// The rejections are NOT thrown away and this is not hiding the funnel: the
// folder header still reports how many were checked and how many were cut, so
// the thoroughness is still legible as a number. What is gone is the browsable
// pile of them mixed in with real work.
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All leads" },
  { key: "qualified", label: "Qualified" },
  { key: "verify", label: "Verify" },
  { key: "fit_only", label: "Fit only" },
];

// A 'filter'/'hybrid' company that fit the ICP with no signal found is
// still status: 'qualified' in the DB (it passed every gate) — confidence:
// null is what actually distinguishes it from a real qualified/verify
// signal match. See orchestrator.ts's finalHasSignal.
function matchesTab(c: Company, tab: Tab) {
  // "All" means every LEAD, not every row the pipeline touched. It used to
  // return true for everything, so the default view of a folder was mostly
  // rejects and the real count was buried.
  if (tab === "all") return c.status === "qualified";
  if (tab === "qualified") return c.status === "qualified" && (c.confidence === "high" || c.confidence === "medium");
  if (tab === "verify") return c.status === "qualified" && c.confidence === "verify";
  if (tab === "fit_only") return c.status === "qualified" && c.confidence === null;
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
  // empty "Qualified" tab reads as broken.
  //
  // "fit_only" was missing from this list, which quietly hid most of a folder.
  // A real run finished 0 qualified / 1 verify / 15 fit-only, so the priority
  // fell through to "verify" and opened on ONE company out of sixteen. The
  // other fifteen were behind a tab you had to already know to press.
  const [tab, setTab] = useState<Tab>(() => {
    const priority: Tab[] = ["qualified", "verify", "fit_only", "all"];
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
      // Best lead first. Sorting by crawl time put whatever was read last at
      // the top, which is an artefact of the pipeline's ordering rather than
      // anything about the companies — the strongest lead in a folder could
      // sit at the bottom for no reason. Ties break on recency so a fresh
      // find outranks an identical older one.
      .sort((a, b) => {
        const d = scoreFactors(b).score - scoreFactors(a).score;
        return d !== 0 ? d : b.lastCrawledAt.localeCompare(a.lastCrawledAt);
      });
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
        {companies.length} leads
      </p>

      {/* Cards, not table rows. The two fields that decide whether he calls —
          the signal quote and the reason it is a lead — are prose, and prose
          does not survive a table column; the old grid answered "what is this
          record" (industry, status, last checked) rather than "why am I
          calling this one". The CSV export keeps the column shape, which is
          where columns are the right answer. */}
      <div className="space-y-2.5 p-4">
        {filtered.map((c, i) => (
          <div key={c.id} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
            <LeadCard company={c} onOpen={() => onRowClick(c)} />
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-gh-ink-muted">
            No leads match these filters.
          </p>
        )}
      </div>
    </div>
  );
}
