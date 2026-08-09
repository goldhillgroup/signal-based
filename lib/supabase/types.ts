// Hand-written to match supabase/migrations/*.sql.
// Regenerate with `npx supabase gen types typescript` once schema drifts.
//
// `Relationships: []` on every table (and empty Views/Functions on the
// schema) aren't decorative — @supabase/postgrest-js's GenericTable/
// GenericSchema constraints require them structurally. Omitting them doesn't
// error here; it silently makes every .from(...) call resolve to `never`,
// which is a much worse failure mode. Keep them even though nothing in this
// app reads them.

export type Industry = "landscaping" | "home_builder";
export type CompanyStatus = "pending" | "qualified" | "rejected";
export type Confidence = "high" | "medium" | "verify";
export type PageType = "about" | "leadership" | "team" | "home" | "other";
export type FindStatus = "not_attempted" | "found" | "not_found";
export type VerificationStatus =
  | "not_attempted"
  | "valid"
  | "invalid"
  | "risky"
  | "unknown";
export type CrawlRunStatus = "running" | "complete" | "failed";
export type SearchStatus = "running" | "complete" | "failed";
// Tracks the manually-triggered enrichment step independently of
// SearchStatus (which only ever describes discovery/classification) — see
// lib/pipeline/orchestrator.ts's enrichContacts().
export type EnrichmentStatus = "idle" | "running" | "complete" | "failed";
// 'signal' — a company only counts if it shows a real succession signal
//   (current/original behavior).
// 'filter' — category + region + size + ownership fit is enough, no signal
//   required. "Get me landscapers in Texas" with nothing else.
// 'hybrid' — same acceptance bar as 'filter' (signal not required to
//   qualify), but every result is tagged has_signal and ranked
//   signal-bearing-first — everyone who fits the ICP, with the real
//   triggers surfaced at the top.
export type SearchMode = "signal" | "filter" | "hybrid";
// Step 04 of the stated method — whether the company runs its own crews or
// subcontracts. Recorded for context, never a rejection gate.
export type OperatingModel = "own_crews" | "subcontract" | "mixed" | "unknown";

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
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
          operating_model: OperatingModel | null;
          recheck_after: string | null;
          first_seen_at: string;
          last_crawled_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["companies"]["Row"]> & {
          domain: string;
          name: string;
          industry: Industry;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Row"]>;
        Relationships: [];
      };
      signal_evidence: {
        Row: {
          id: string;
          company_id: string;
          quote: string;
          source_url: string;
          page_type: PageType | null;
          disprove_notes: string | null;
          extracted_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["signal_evidence"]["Row"]> & {
          company_id: string;
          quote: string;
          source_url: string;
        };
        Update: Partial<Database["public"]["Tables"]["signal_evidence"]["Row"]>;
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          company_id: string;
          name: string | null;
          name_inferred: boolean;
          title: string | null;
          email: string | null;
          find_status: FindStatus;
          find_source: string | null;
          verification_status: VerificationStatus;
          verification_source: string | null;
          verified_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["contacts"]["Row"]> & {
          company_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["contacts"]["Row"]>;
        Relationships: [];
      };
      crawl_runs: {
        Row: {
          id: string;
          started_at: string;
          finished_at: string | null;
          status: CrawlRunStatus;
          companies_scanned: number;
          newly_discovered: number;
          newly_qualified: number;
          newly_rejected: number;
          error_message: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["crawl_runs"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["crawl_runs"]["Row"]>;
        Relationships: [];
      };
      searches: {
        Row: {
          id: string;
          query: string;
          label: string;
          status: SearchStatus;
          mode: SearchMode;
          error_message: string | null;
          /** Degraded-but-successful run note — see channel-health.ts. */
          warnings: string | null;
          /** Estimated vendor spend for this run — see cost-tracker.ts. */
          cost_estimate_usd: number | null;
          /** Human-readable call counts behind the estimate. */
          cost_breakdown: string | null;
          enrichment_status: EnrichmentStatus;
          enrichment_error: string | null;
          // Start of the current enrichment pass. Null means never enriched,
          // or a row predating the column — reapStaleEnrichment leaves both
          // alone rather than dating them by guesswork.
          enrichment_started_at: string | null;
          target_signals: number;
          revenue_min_musd: number | null;
          revenue_max_musd: number | null;
          candidates_pool_exhausted: boolean;
          candidates_found: number;
          pages_fetched: number;
          companies_scanned: number;
          qualified_count: number;
          verify_count: number;
          fit_only_count: number;
          rejected_count: number;
          contacts_found: number;
          contacts_verified: number;
          created_by: string | null;
          created_at: string;
          finished_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["searches"]["Row"]> & {
          query: string;
          label: string;
        };
        Update: Partial<Database["public"]["Tables"]["searches"]["Row"]>;
        Relationships: [];
      };
      // Service-role only — see supabase/migrations/20260806010000_app_settings.sql.
      // No RLS policies at all, so this table is unreachable from the
      // browser's Supabase client even for a logged-in user.
      app_settings: {
        Row: {
          key: string;
          value: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["app_settings"]["Row"]> & {
          key: string;
          value: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Row"]>;
        Relationships: [];
      };
      // Directory-source cache — see supabase/migrations/20260806020000_directory_sources.sql.
      directory_sources: {
        Row: {
          id: string;
          industry: string;
          state: string;
          angle: string;
          source_url: string;
          hit_count: number;
          discovered_at: string;
          last_used_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["directory_sources"]["Row"]> & {
          industry: string;
          state: string;
          angle: string;
          source_url: string;
        };
        Update: Partial<Database["public"]["Tables"]["directory_sources"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}

export type SearchRow = Database["public"]["Tables"]["searches"]["Row"];
