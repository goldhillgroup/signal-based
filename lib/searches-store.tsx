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
import { useRouter } from "next/navigation";
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
import { isSharedInbox } from "./pipeline/page-email";

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
  // NOT contacts[0]. That was whichever row the database returned first, so a
  // company with both info@ and the founder's own address showed whichever
  // won the race — and a free footer scrape of info@ could displace the
  // address that had actually been paid for. Rank instead: a settled lookup
  // beats a parked one, and a named person beats a shared inbox.
  const ranked = [...(row.contacts ?? [])].sort((a, b) => {
    const settled = (c: typeof a) => (c.find_status === "found" ? 1 : 0);
    const personal = (c: typeof a) => (c.email && !isSharedInbox(c.email) ? 1 : 0);
    return settled(b) - settled(a) || personal(b) - personal(a);
  });
  const contact = ranked[0];
  // The best SHARED inbox, kept alongside rather than instead of the above.
  const backup = ranked.find((c) => c.email && isSharedInbox(c.email) && c !== contact);
  return {
    id: row.id,
    searchId: row.search_id ?? null,
    domain: row.domain,
    name: row.name,
    industry: row.industry,
    state: row.state ?? "-",
    city: row.city ?? "-",
    // Google Places supplies it for Maps companies; for every other channel it
    // is read off the page footer at classify time (see bestPhoneFor). Null
    // only when the page genuinely prints no number.
    phone: (row as { phone?: string | null }).phone ?? null,
    address: (row as { address?: string | null }).address ?? null,
    // "Size not stated" rather than "Unknown". 75% of rows have no revenue
    // figure at all — the classifier estimates size from soft textual proxies
    // and most sites give it nothing to work from — so this is the common
    // case, not an edge one. "Unknown" reads like a verdict about the company;
    // this says plainly that the SITE did not say, which is the actual fact
    // and which is why size is never grounds for cutting one.
    revenueBand: row.revenue_band ?? "Size not stated",
    employeeBand: row.employee_band ?? "not stated",
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
    backupContact: backup
      ? {
          name: backup.name,
          nameInferred: backup.name_inferred,
          title: backup.title,
          email: backup.email,
          findStatus: backup.find_status,
          verificationStatus: backup.verification_status,
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
    /** Verticals to search. Empty or omitted means every vertical in the ICP. */
    industries?: Industry[];
    /** Older single-vertical callers. `industries` wins when both are given. */
    industry?: Industry;
    /** Structured form path. Use `states` for multi-state free-text requests. */
    state?: string;
    states?: string[];
    refinement?: string;
    targetSignals: number;
    revenueMinMusd?: number | null;
    revenueMaxMusd?: number | null;
    mode?: SearchMode;
    /** Re-read companies already judged instead of skipping them. Off by
     *  default — see runSearchPipeline's includeAlreadyChecked. */
    includeAlreadyChecked?: boolean;
  }) => Promise<{ id: string; label: string }>;
  /**
   * `companyIds` is an explicit pick and overrides `scope` server-side. It is
   * how a rejected company gets an address looked up — the scope words only
   * ever reach status='qualified'.
   */
  startEnrichment: (
    searchId: string,
    scope?: "signals" | "all",
    companyIds?: string[]
  ) => Promise<void>;
  deleteSearch: (searchId: string) => Promise<void>;
  renameSearch: (searchId: string, label: string) => Promise<void>;
  /** Rejections for one folder. Separate because the lead views deliberately exclude them. */
  fetchRejected: (searchId: string) => Promise<Company[]>;
}

const SearchesContext = createContext<SearchesContextValue | null>(null);

export function SearchesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
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

  // Load once on mount. The rule this silences is about setState called
  // SYNCHRONOUSLY in an effect body causing a cascading render; refreshFolders
  // is async and every setState inside it happens after an await, in a later
  // tick, which is the "subscribe to an external system and set state in a
  // callback" shape the rule explicitly allows. The linter cannot see through
  // the indirection to know that.
  //
  // The alternatives are worse: fetching during render is not allowed, and a
  // Suspense-based read would make the whole dashboard shell wait on a query
  // that only some of it needs.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // Leads AND the companies that were cut. The cut ones are not mixed into
    // the lead list — CompaniesTable files them under their own "Not a fit"
    // tab, and the page's headline counts only status='qualified' — but they
    // have to be fetched for that tab to have anything in it.
    //
    // search_id NOT NULL is the other half, and it is not optional.
    // reset-leads.mts empties the dashboard by DETACHING companies rather than
    // deleting them — that is what preserves cross-search memory, the recheck
    // schedule and the channel priors, and its whole safety argument is that
    // "the UI only ever shows leads through a folder, so a company with no
    // folder is invisible while remaining fully known".
    //
    // This query was the one place that was not true. It counted every
    // qualified row in the database, so All Leads announced "80 leads across 1
    // folder, open one to see them" while the only folder held 28 and the other
    // 52 were detached memory with no folder to open. The sidebar and the
    // folder tile both said 28, because they aggregate folder counts — so the
    // dashboard disagreed with itself on its headline number.
    const { data, error } = await supabase
      .from("companies")
      .select("*, signal_evidence(*), contacts(*)")
      .in("status", ["qualified", "rejected"])
      .not("search_id", "is", null)
      .order("last_crawled_at", { ascending: false });
    if (error || !data) return [];
    return bySignalFirst((data as unknown as CompanyJoinRow[]).map(mapCompanyRow));
  }, [supabase]);

  const createSearch = useCallback(
    async (params: {
      industries?: Industry[];
      industry?: Industry;
      state?: string;
      states?: string[];
      refinement?: string;
      targetSignals: number;
      revenueMinMusd?: number | null;
      revenueMaxMusd?: number | null;
      mode?: SearchMode;
      includeAlreadyChecked?: boolean;
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

  const startEnrichment = useCallback(
    async (searchId: string, scope: "signals" | "all" = "signals", companyIds?: string[]) => {
      const res = await fetch(`/api/search/${searchId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, companyIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Enrichment failed to start");
      }
      // Pull the row back so the caller's UI sees enrichment_status flip to
      // 'running'. Without this the POST succeeded, the server started work,
      // and the screen did not move by a single pixel — which reads as a dead
      // button, so the natural response is to press it again. It was reported
      // as "I clicked and nothing happened" while the run was in fact already
      // finding contacts.
      await refreshFolders();
      // The Overview is a SERVER component: it reads "Recent searches" straight
      // from the database when the page renders. Dropping the folder from this
      // client store therefore leaves it sitting on that page until a hard
      // reload, so a list deleted from Lead Lists was still listed on the home
      // screen. refresh() re-runs the server render.
      router.refresh();
    },
    [refreshFolders, router]
  );

  // Loaded on demand, never with the leads. The lead views carry rejections in
  // their own "Not a fit" tab, but this panel needs them GROUPED BY REASON and
  // for a single folder, so the evidence section that argues the
  // rejections matter has to ask for them separately.
  const fetchRejected = useCallback(
    async (searchId: string): Promise<Company[]> => {
      const { data, error } = await supabase
        .from("companies")
        .select("*, signal_evidence(*), contacts(*)")
        .eq("search_id", searchId)
        .eq("status", "rejected")
        .order("name", { ascending: true });
      if (error || !data) return [];
      return (data as unknown as CompanyJoinRow[]).map(mapCompanyRow);
    },
    [supabase]
  );

  const renameSearch = useCallback(
    async (searchId: string, label: string) => {
      // Optimistic: the new name is on screen before the round trip, because a
      // rename that visibly lags reads as a rename that failed and invites a
      // second attempt. Reconciled by refreshFolders below.
      setFolders((prev) => prev.map((f) => (f.id === searchId ? { ...f, label } : f)));
      const res = await fetch(`/api/search/${searchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        await refreshFolders(); // put the old name back
        throw new Error(body?.error ?? "Could not rename this folder.");
      }
      await refreshFolders();
    },
    [refreshFolders]
  );

  const deleteSearch = useCallback(
    async (searchId: string) => {
      // OPTIMISTIC, WHICH THE OLD COMMENT CLAIMED AND THE CODE DID NOT DO.
      //
      // It said "drop it locally first so the list updates instantly" and then
      // dropped it AFTER awaiting the request, so pressing Delete left the
      // folder sitting there for the whole round trip and a refresh after it —
      // one to two seconds of the screen looking like nothing happened, which
      // reads as a broken button and invites a second click.
      //
      // A progress bar would be worse: there is no progress to report, only a
      // request in flight, and a bar that fills on a timer is a lie. Removing
      // the row immediately is honest, because the delete is going to succeed;
      // the rare failure puts it straight back.
      setFolders((prev) => prev.filter((f) => f.id !== searchId));
      try {
        const res = await fetch(`/api/search/${searchId}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "Could not delete this search.");
        }
      } catch (e) {
        // Restore from the SERVER rather than from a snapshot in memory. A
        // snapshot taken inside the setState callback is not safe to rely on —
        // React may invoke that callback twice — and the server is the truth
        // about what still exists anyway.
        await refreshFolders();
        throw e;
      }
      await refreshFolders();
    },
    [refreshFolders]
  );

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
      deleteSearch,
      renameSearch,
      fetchRejected,
    }),
    [folders, loading, refreshFolders, getFolder, fetchFolder, fetchCompanies, fetchAllCompanies, createSearch, startEnrichment, deleteSearch, renameSearch, fetchRejected]
  );

  return <SearchesContext.Provider value={value}>{children}</SearchesContext.Provider>;
}

export function useSearches() {
  const ctx = useContext(SearchesContext);
  if (!ctx) throw new Error("useSearches must be used within SearchesProvider");
  return ctx;
}
