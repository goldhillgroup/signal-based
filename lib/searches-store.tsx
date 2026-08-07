"use client";

// Real Supabase-backed replacement for the earlier client-Context mock.
// Folders (`searches` rows) and their companies now live in the database —
// see supabase/migrations/20260805010000_searches.sql and
// lib/pipeline/orchestrator.ts for what actually populates them.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { createClient } from "./supabase/client";
import type {
  SearchRow,
  SearchStatus,
  SearchMode,
  EnrichmentStatus,
  Industry,
  CompanyStatus,
  Confidence,
  PageType,
  FindStatus,
  VerificationStatus,
} from "./supabase/types";
import type { Company } from "./company";

export interface SearchFolder {
  id: string;
  query: string;
  label: string;
  status: SearchStatus;
  mode: SearchMode;
  enrichmentStatus: EnrichmentStatus;
  enrichmentError: string | null;
  errorMessage: string | null;
  /** Channels unavailable during an otherwise successful run. */
  warnings: string | null;
  /** Estimated vendor spend for this run + the call counts behind it. */
  costEstimateUsd: number | null;
  costBreakdown: string | null;
  createdAt: string;
  finishedAt: string | null;
  targetSignals: number;
  candidatesPoolExhausted: boolean;
  candidatesFound: number;
  pagesFetched: number;
  companiesScanned: number;
  qualifiedCount: number;
  verifyCount: number;
  fitOnlyCount: number;
  rejectedCount: number;
  contactsFound: number;
  contactsVerified: number;
}

function mapSearchRow(row: SearchRow): SearchFolder {
  return {
    id: row.id,
    query: row.query,
    label: row.label,
    status: row.status,
    mode: row.mode,
    enrichmentStatus: row.enrichment_status,
    enrichmentError: row.enrichment_error,
    errorMessage: row.error_message,
    warnings: row.warnings,
    costEstimateUsd: row.cost_estimate_usd,
    costBreakdown: row.cost_breakdown,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    targetSignals: row.target_signals,
    candidatesPoolExhausted: row.candidates_pool_exhausted,
    candidatesFound: row.candidates_found,
    pagesFetched: row.pages_fetched,
    companiesScanned: row.companies_scanned,
    contactsFound: row.contacts_found,
    contactsVerified: row.contacts_verified,
    qualifiedCount: row.qualified_count,
    verifyCount: row.verify_count,
    fitOnlyCount: row.fit_only_count,
    rejectedCount: row.rejected_count,
  };
}

// Supabase's PostgREST embeds a to-many relation as an array even when it's
// functionally one row (one evidence quote, one contact per company here).
interface CompanyJoinRow {
  id: string;
  /** Nullable in the schema — rows predating the searches table have none. */
  search_id: string | null;
  domain: string;
  name: string;
  industry: Industry;
  state: string | null;
  city: string | null;
  revenue_band: string | null;
  employee_band: string | null;
  status: CompanyStatus;
  confidence: Confidence | null;
  rejection_reason: string | null;
  founder_name: string | null;
  founder_title: string | null;
  next_gen_name: string | null;
  next_gen_title: string | null;
  source_url: string | null;
  has_signal: boolean | null;
  discovery_channel: string | null;
  operating_model: string | null;
  first_seen_at: string;
  last_crawled_at: string;
  signal_evidence: Array<{
    quote: string;
    source_url: string;
    page_type: PageType;
    disprove_notes: string | null;
  }>;
  contacts: Array<{
    name: string | null;
    name_inferred: boolean;
    title: string | null;
    email: string | null;
    find_status: FindStatus;
    verification_status: VerificationStatus;
  }>;
}

function mapCompanyRow(row: CompanyJoinRow): Company {
  const evidence = row.signal_evidence?.[0];
  const contact = row.contacts?.[0];
  return {
    id: row.id,
    searchId: row.search_id ?? null,
    domain: row.domain,
    name: row.name,
    industry: row.industry,
    state: row.state ?? "—",
    city: row.city ?? "—",
    revenueBand: row.revenue_band ?? "Unknown",
    employeeBand: row.employee_band ?? "Unknown",
    status: row.status,
    confidence: row.confidence,
    rejectionReason: row.rejection_reason,
    founderName: row.founder_name,
    founderTitle: row.founder_title,
    nextGenName: row.next_gen_name,
    nextGenTitle: row.next_gen_title,
    sourceUrl: row.source_url,
    hasSignal: row.has_signal,
    discoveryChannel: row.discovery_channel,
    operatingModel: row.operating_model,
    firstSeenAt: row.first_seen_at,
    lastCrawledAt: row.last_crawled_at,
    evidence: evidence
      ? {
          quote: evidence.quote,
          sourceUrl: evidence.source_url,
          pageType: evidence.page_type,
          disproveNotes: evidence.disprove_notes ?? undefined,
        }
      : null,
    contact: contact
      ? {
          name: contact.name,
          nameInferred: contact.name_inferred,
          title: contact.title,
          email: contact.email,
          findStatus: contact.find_status,
          verificationStatus: contact.verification_status,
        }
      : null,
  };
}

interface SearchesContextValue {
  folders: SearchFolder[];
  loading: boolean;
  refreshFolders: () => Promise<void>;
  getFolder: (id: string) => SearchFolder | undefined;
  fetchFolder: (id: string) => Promise<SearchFolder | null>;
  fetchCompanies: (id: string) => Promise<Company[]>;
  // Every lead across every search, combined — "one folder of all of the
  // leads" rather than needing to open each search individually to see
  // what's in it. Same single-tenant model as the rest of the app (RLS is
  // "any authenticated user sees everything"), so this is genuinely all of
  // Jonathan's leads, not scoped to one search_id.
  fetchAllCompanies: () => Promise<Company[]>;
  createSearch: (params: {
    industry: Industry;
    /** Structured form path. Use `states` for multi-state free-text requests. */
    state?: string;
    states?: string[];
    refinement?: string;
    targetSignals: number;
    revenueMinMusd?: number | null;
    revenueMaxMusd?: number | null;
    mode?: SearchMode;
  }) => Promise<{ id: string; label: string }>;
  startEnrichment: (searchId: string, scope?: "signals" | "all") => Promise<void>;
}

const SearchesContext = createContext<SearchesContextValue | null>(null);

export function SearchesProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [folders, setFolders] = useState<SearchFolder[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshFolders = useCallback(async () => {
    const { data } = await supabase
      .from("searches")
      .select("*")
      .order("created_at", { ascending: false });
    setFolders((data ?? []).map(mapSearchRow));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refreshFolders();
  }, [refreshFolders]);

  const getFolder = useCallback((id: string) => folders.find((f) => f.id === id), [folders]);

  const fetchFolder = useCallback(
    async (id: string): Promise<SearchFolder | null> => {
      const { data } = await supabase.from("searches").select("*").eq("id", id).single();
      return data ? mapSearchRow(data) : null;
    },
    [supabase]
  );

  // Signal-bearing companies first, same pattern used on the Ofer Lieberson
  // project: everyone who fits the ICP is in the list, but the real dated
  // triggers surface at the top rather than being buried
  // alphabetically/chronologically among plain fit-only results. A no-op
  // ordering-wise for 'signal' mode, where every qualified row has a signal
  // by definition.
  function bySignalFirst(companies: Company[]): Company[] {
    return [...companies].sort((a, b) => Number(b.hasSignal) - Number(a.hasSignal));
  }

  const fetchCompanies = useCallback(
    async (id: string): Promise<Company[]> => {
      const { data, error } = await supabase
        .from("companies")
        .select("*, signal_evidence(*), contacts(*)")
        .eq("search_id", id)
        .order("last_crawled_at", { ascending: false });
      if (error || !data) return [];
      return bySignalFirst((data as unknown as CompanyJoinRow[]).map(mapCompanyRow));
    },
    [supabase]
  );

  const fetchAllCompanies = useCallback(async (): Promise<Company[]> => {
    // Only accepted leads (status: 'qualified' — covers qualified/verify/
    // fit-only, see orchestrator.ts) belong in the combined view; a
    // rejected candidate from search A shouldn't clutter "all of Jonathan's
    // leads" just because it happened to get scanned.
    const { data, error } = await supabase
      .from("companies")
      .select("*, signal_evidence(*), contacts(*)")
      .eq("status", "qualified")
      .order("last_crawled_at", { ascending: false });
    if (error || !data) return [];
    return bySignalFirst((data as unknown as CompanyJoinRow[]).map(mapCompanyRow));
  }, [supabase]);

  const createSearch = useCallback(
    async (params: {
      industry: Industry;
      state?: string;
      states?: string[];
      refinement?: string;
      targetSignals: number;
      revenueMinMusd?: number | null;
      revenueMaxMusd?: number | null;
      mode?: SearchMode;
    }) => {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Search failed to start");
      }
      const data = (await res.json()) as { id: string; label: string };
      await refreshFolders();
      return data;
    },
    [refreshFolders]
  );

  const startEnrichment = useCallback(async (searchId: string, scope: "signals" | "all" = "signals") => {
    const res = await fetch(`/api/search/${searchId}/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? "Enrichment failed to start");
    }
  }, []);

  const value = useMemo<SearchesContextValue>(
    () => ({
      folders,
      loading,
      refreshFolders,
      getFolder,
      fetchFolder,
      fetchCompanies,
      fetchAllCompanies,
      createSearch,
      startEnrichment,
    }),
    [folders, loading, refreshFolders, getFolder, fetchFolder, fetchCompanies, fetchAllCompanies, createSearch, startEnrichment]
  );

  return <SearchesContext.Provider value={value}>{children}</SearchesContext.Provider>;
}

export function useSearches() {
  const ctx = useContext(SearchesContext);
  if (!ctx) throw new Error("useSearches must be used within SearchesProvider");
  return ctx;
}
