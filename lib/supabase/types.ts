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
          error_message: string | null;
          candidates_found: number;
          pages_fetched: number;
          companies_scanned: number;
          qualified_count: number;
          verify_count: number;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}

export type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
export type SignalEvidenceRow = Database["public"]["Tables"]["signal_evidence"]["Row"];
export type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
export type CrawlRunRow = Database["public"]["Tables"]["crawl_runs"]["Row"];
export type SearchRow = Database["public"]["Tables"]["searches"]["Row"];
