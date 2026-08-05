-- The search target is a signal count, not a raw candidate count — "give me
-- 100 signals" means keep discovering + classifying until ~100 companies
-- clear classification (qualified + verify), not "scan 100 companies."
alter table searches add column if not exists target_signals integer not null default 20;
alter table searches add column if not exists candidates_pool_exhausted boolean not null default false;

comment on column searches.target_signals is
  'Requested signal count. The pipeline loops discover->fetch->classify in '
  'rounds, accumulating qualified+verify companies, until this is reached, '
  'the safety ceiling in lib/pipeline/orchestrator.ts is hit, or the search '
  'query runs out of fresh candidates (candidates_pool_exhausted).';
