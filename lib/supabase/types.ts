// Hand-written to match supabase/migrations/20260805000000_signal_radar_schema.sql.
// Regenerate with `npx supabase gen types typescript` once a live project exists
// and this file drifts from the real schema.

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

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
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
      };
    };
  };
}

export type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
export type SignalEvidenceRow = Database["public"]["Tables"]["signal_evidence"]["Row"];
export type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
export type CrawlRunRow = Database["public"]["Tables"]["crawl_runs"]["Row"];
