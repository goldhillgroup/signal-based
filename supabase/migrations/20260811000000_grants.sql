-- Grant the PostgREST roles access to everything the other migrations create.
--
-- WHY THIS EXISTS. Every other migration in this folder creates tables and RLS
-- policies but never grants table privileges. That works on a project whose
-- tables were made through the Supabase dashboard, because the dashboard's
-- editor runs with default privileges already configured — and it silently
-- does NOT work on a project built by running these files.
--
-- Found the hard way while moving to a new project: all eleven migrations
-- applied cleanly, every table existed, RLS was correct, and every single
-- request came back
--
--   42501  permission denied for table companies
--   hint: Grant the required privileges to the current role with:
--         GRANT SELECT, INSERT, UPDATE ON public.companies TO service_role;
--
-- PostgREST connects AS anon / authenticated / service_role. Without a grant,
-- row-level security never even gets consulted; the role cannot touch the table
-- at all. So a fresh install looked completely broken with a correct schema.
--
-- SAFE TO RE-RUN, and safe on a project that already works: GRANT is idempotent
-- and these are the privileges Supabase itself assigns by default.
--
-- The ALTER DEFAULT PRIVILEGES lines matter as much as the grants. Without
-- them, the NEXT migration to add a table reintroduces exactly this bug, and it
-- will look like a brand-new failure rather than a known one.

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables    in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
grant all privileges on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
