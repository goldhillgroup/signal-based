-- Directory-source memory — the actual lesson from the Ofer Lieberson
-- project: structured directories (industry association member lists,
-- licensing boards) are the highest-yield discovery source, but finding
-- WHICH directory covers a given vertical+state is itself expensive (a real
-- web-search LLM call). Once found, the URL almost never changes — so cache
-- it, and every future search for the same vertical+state skips straight to
-- "fetch this known page and extract from it" (cheap: a plain fetch + a
-- non-search extraction call) instead of "search the web to find a
-- directory" (expensive: a web-search-enabled model call) every single time.
create table if not exists directory_sources (
  id            uuid primary key default gen_random_uuid(),
  industry      text not null,
  state         text not null,
  angle         text not null, -- which DIRECTORY_ANGLES entry this came from
  source_url    text not null, -- the actual directory/listing page found
  hit_count     integer not null default 0, -- real candidates it has produced, lifetime
  discovered_at timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  unique (industry, state, angle)
);

alter table directory_sources enable row level security;
-- Service-role only, same reasoning as app_settings — no anon/authenticated
-- policies. Not a secret, but there's no product reason for the browser's
-- Supabase client to ever touch this table directly.
