-- When the current enrichment pass began.
--
-- Enrichment runs in a detached `after()` continuation with the same 300s
-- platform ceiling as discovery, and it had no watchdog. A killed pass left
-- enrichment_status = 'running' forever: the Enrichment page showed the folder
-- stuck under "Running now", and the route refuses to start a second pass while
-- one is already running, so the folder could never be enriched again.
--
-- That is not hypothetical. The exact same failure hit discovery in production
-- on 2026-08-09 — a run was cut off at the ceiling and sat at status 'running'
-- with 16 paid-for leads invisible behind it, which also blocked Enrich (that
-- route requires status = 'complete'). reapStaleRuns fixed it for discovery
-- using created_at, because a search row is created immediately before its run
-- starts so created_at IS the start time.
--
-- Enrichment has no such column. It begins minutes or days after the search
-- finished, so nothing already on the row can date it, and without a start time
-- a dead pass is indistinguishable from one that began four seconds ago.
--
-- Nullable, no backfill: rows predating this simply have no start time, and the
-- reaper leaves anything it cannot date alone rather than guessing.
alter table searches add column if not exists enrichment_started_at timestamptz;

comment on column searches.enrichment_started_at is
  'Start of the current enrichment pass. Used by reapStaleEnrichment to close out passes killed by the platform function ceiling. Null means never enriched, or a row created before this column existed.';
