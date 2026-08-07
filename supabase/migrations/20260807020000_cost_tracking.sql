-- Per-search cost visibility.
--
-- Every cost problem this project has hit (":online" silently eating $26 in
-- a day, Maps re-buying the same places at $0.24 -> $1.20 per round) was
-- discovered AFTER the money was gone, by digging through vendor dashboards.
-- The pipeline now meters its own vendor calls (lib/pipeline/cost-tracker.ts)
-- and writes the totals here when a run finishes — so the cost of a search is
-- a number on the search row, not archaeology.
alter table searches add column if not exists cost_estimate_usd numeric;
alter table searches add column if not exists cost_breakdown text;

comment on column searches.cost_estimate_usd is
  'Estimated vendor spend for this run (USD), from measured per-unit prices '
  '— see UNIT_USD in lib/pipeline/cost-tracker.ts. An estimate for relative '
  'visibility, not accounting.';
comment on column searches.cost_breakdown is
  'Human-readable call counts behind the estimate, e.g. '
  '"12 classify/disprove · 3 searches · 30 map places".';
