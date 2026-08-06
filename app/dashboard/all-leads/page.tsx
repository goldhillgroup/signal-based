"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearches } from "@/lib/searches-store";
import { Company } from "@/lib/mock-companies";
import { getSummaryStats } from "@/lib/stats";
import { downloadCompaniesCsv } from "@/lib/csv-export";
import { CompaniesTable } from "@/components/CompaniesTable";
import { CompanyDrawer } from "@/components/CompanyDrawer";
import { DownloadIcon, RadarIcon } from "@/components/icons";

// "One folder of all of the leads" — every accepted company from every
// search, combined, with the same one-click download as a single search's
// results. This is the destination for "just give me the spreadsheet,"
// without needing to know which search a given lead came from first.
export default function AllLeadsPage() {
  const { fetchAllCompanies } = useSearches();
  const [companies, setCompanies] = useState<Company[] | "loading">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const stats = getSummaryStats(companies);
  const selected = companies.find((c) => c.id === selectedId) ?? null;

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
            Every accepted company from every search, combined — {stats.total} total.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCompaniesCsv(companies, "all-leads")}
          disabled={companies.length === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gh-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <DownloadIcon className="h-4 w-4" />
          Download all as spreadsheet
        </button>
      </div>

      {companies.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gh-border bg-gh-surface p-10 text-center text-sm text-gh-ink-muted">
          Nothing here yet —{" "}
          <Link href="/dashboard" className="font-medium text-gh-sky hover:underline">
            run a search
          </Link>{" "}
          to start finding leads.
        </p>
      ) : (
        <CompaniesTable companies={companies} onRowClick={(c) => setSelectedId(c.id)} />
      )}

      <CompanyDrawer company={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
