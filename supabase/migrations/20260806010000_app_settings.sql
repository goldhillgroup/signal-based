-- API keys editable from a Settings page in the dashboard instead of only
-- via Vercel/.env env vars — so switching an Apify/OpenRouter account (or
-- rotating a key) doesn't require a redeploy.
--
-- Deliberately NO RLS policies for anon/authenticated — this table is
-- reachable ONLY through the service-role client (lib/settings.ts), never
-- through the browser's Supabase client, even for a logged-in user. A raw
-- API key must never round-trip to client-side JS. RLS is enabled with zero
-- policies, which is a hard "nobody but service-role" rather than relying on
-- application code alone to remember not to expose it.
create table if not exists app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

alter table app_settings enable row level security;
-- No policies added on purpose — see comment above.
