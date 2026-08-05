-- Signal Radar — Family Business Sourcing Engine (Jonathan Goldhill)
-- Schema matches the scope doc's real pipeline:
--   Apify (discover + fetch) -> OpenRouter (classify + disprove pass)
--   -> Anymailfinder (contact) -> MillionVerifier (deliverability) -> this DB -> dashboard
--
-- Single-tenant (Jonathan only, plus whoever on his team gets an auth.users row) —
-- RLS is "any authenticated user can read/write everything," not per-user scoping.
-- If a second client ever runs this same schema, add a workspace_id / user_id column
-- and switch these policies to scope by it — don't reuse this migration as multi-tenant as-is.

create extension if not exists "pgcrypto";

-- ── companies ────────────────────────────────────────────────────────────────
-- One row per discovered company. Never deleted — rejected companies stay with
-- a reason, matching the proof's "labeled, not hidden" standard.
create table if not exists companies (
  id                 uuid primary key default gen_random_uuid(),
  domain             text not null unique,
  name               text not null,
  industry           text not null check (industry in ('landscaping', 'home_builder')),
  state              text,
  city               text,
  revenue_band       text,                    -- e.g. "$3M-$5M" — display only, not authoritative
  employee_band      text,

  -- Overall bucket: did it clear the bar or not. "verify" confidence companies
  -- are still qualified=true but flagged for a human look before acting.
  status             text not null default 'pending'
                       check (status in ('pending', 'qualified', 'rejected')),
  confidence         text check (confidence in ('high', 'medium', 'verify')),
  rejection_reason   text,                    -- required in practice when status = 'rejected'

  founder_name       text,
  founder_title      text,
  next_gen_name      text,
  next_gen_title     text,

  source_url         text,                    -- the About/Leadership/Team page URL the signal came from
  first_seen_at      timestamptz not null default now(),
  last_crawled_at    timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column companies.status is
  'pending = discovered, not yet classified or re-classification in flight. '
  'qualified = passed the two-generation + succession-language test. '
  'rejected = explicitly cut, reason required — never just deleted.';
comment on column companies.confidence is
  'Set only when status = qualified. verify = borderline, matches proof''s '
  '"show a Medium, never a false High" standard — needs a human look.';

create index if not exists companies_status_idx on companies (status);
create index if not exists companies_industry_idx on companies (industry);
create index if not exists companies_last_crawled_idx on companies (last_crawled_at);

-- ── signal_evidence ─────────────────────────────────────────────────────────
-- The exact quote + source the classification was based on, plus the disprove
-- pass's notes (the scope's "deliberately tries to disprove the classification"
-- step) — this is what makes a confidence label defensible on the dashboard.
create table if not exists signal_evidence (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies (id) on delete cascade,
  quote              text not null,
  source_url         text not null,
  page_type          text check (page_type in ('about', 'leadership', 'team', 'home', 'other')),
  disprove_notes     text,                    -- why the disprove pass did/didn't overturn the classification
  extracted_at       timestamptz not null default now()
);

create index if not exists signal_evidence_company_idx on signal_evidence (company_id);

-- ── contacts ─────────────────────────────────────────────────────────────────
-- Only populated for qualified companies (Anymailfinder + MillionVerifier run
-- post-qualification only, per scope — not on the full scanned pool).
create table if not exists contacts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies (id) on delete cascade,
  name                   text,
  name_inferred          boolean not null default false,   -- true = read off the email handle, not from page copy
  title                  text,
  email                  text,

  find_status            text not null default 'not_attempted'
                            check (find_status in ('not_attempted', 'found', 'not_found')),
  find_source            text default 'anymailfinder',

  verification_status    text not null default 'not_attempted'
                            check (verification_status in
                              ('not_attempted', 'valid', 'invalid', 'risky', 'unknown')),
  verification_source    text default 'millionverifier',
  verified_at            timestamptz,

  created_at             timestamptz not null default now()
);

create index if not exists contacts_company_idx on contacts (company_id);

comment on column contacts.find_status is
  'not_found is a real, expected outcome at this ICP size (often <20 employees, '
  'shared inbox) — shown on the dashboard as "qualified, contact not found," never dropped.';

-- ── crawl_runs ───────────────────────────────────────────────────────────────
-- One row per scheduled Apify + OpenRouter pass, for the dashboard's "last
-- scraped" readout and a simple run history / volume trend.
create table if not exists crawl_runs (
  id                 uuid primary key default gen_random_uuid(),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  status             text not null default 'running'
                       check (status in ('running', 'complete', 'failed')),
  companies_scanned  integer not null default 0,   -- new + re-checked pending/verify/rejected companies
  newly_discovered   integer not null default 0,
  newly_qualified    integer not null default 0,
  newly_rejected     integer not null default 0,
  error_message      text
);

-- ── updated_at trigger ──────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists companies_set_updated_at on companies;
create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Single-tenant tool: any signed-in user (Jonathan + team) sees and can act on
-- everything. Service-role key (used by the crawler/classification jobs) bypasses
-- RLS entirely, so this only governs what the dashboard's browser/session client sees.
alter table companies enable row level security;
alter table signal_evidence enable row level security;
alter table contacts enable row level security;
alter table crawl_runs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'companies' and policyname = 'Authenticated read/write') then
    create policy "Authenticated read/write" on companies for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'signal_evidence' and policyname = 'Authenticated read/write') then
    create policy "Authenticated read/write" on signal_evidence for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'contacts' and policyname = 'Authenticated read/write') then
    create policy "Authenticated read/write" on contacts for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crawl_runs' and policyname = 'Authenticated read/write') then
    create policy "Authenticated read/write" on crawl_runs for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;
