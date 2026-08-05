-- Searches — one row per "what Jonathan typed and pressed Search on" (a folder
-- in the UI). Every discovered company is scoped to exactly one search (see
-- companies.search_id) per the product decision: each search is its own
-- self-contained result set, not a saved filter over one shared pool.

create table if not exists searches (
  id                 uuid primary key default gen_random_uuid(),
  query              text not null,
  label              text not null,
  status             text not null default 'running'
                       check (status in ('running', 'complete', 'failed')),
  error_message      text,

  -- Live progress counters the client polls while status = 'running'.
  candidates_found   integer not null default 0,   -- Apify discovery step
  pages_fetched      integer not null default 0,   -- Apify fetch step
  companies_scanned  integer not null default 0,   -- denominator for pages_fetched
  qualified_count    integer not null default 0,
  verify_count       integer not null default 0,
  rejected_count     integer not null default 0,
  contacts_found     integer not null default 0,
  contacts_verified  integer not null default 0,

  created_by         uuid references auth.users,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz
);

alter table companies add column if not exists search_id uuid references searches(id) on delete cascade;
create index if not exists companies_search_idx on companies (search_id);

-- domain was globally unique before; a company found by two different
-- searches should be able to appear in both folders (product decision:
-- "each search is its own folder"), so scope uniqueness to (search_id, domain).
alter table companies drop constraint if exists companies_domain_key;
create unique index if not exists companies_search_domain_idx on companies (search_id, domain);

alter table searches enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'searches' and policyname = 'Authenticated read/write') then
    create policy "Authenticated read/write" on searches for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;
