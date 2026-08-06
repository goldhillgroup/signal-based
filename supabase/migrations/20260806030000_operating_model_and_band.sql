-- Closes three gaps against Jonathan's own stated 4-step method.
--
-- STEP 04 ("operating model, then reach") was missing entirely: his delivered
-- proof shows a "Crews:" line on every card — "Direct crews" / "Mixed (crews
-- + subs)" / "Subcontracts" — and nothing in this app captured it. It's a
-- real qualifier for him (a company running its own crews is a different
-- coaching engagement than one that subcontracts everything).
alter table companies add column if not exists operating_model text
  check (operating_model in ('own_crews', 'subcontract', 'mixed', 'unknown'));

-- STEP 01's revenue band, as an ADJUSTABLE DEFAULT rather than either a hard
-- rule or (as it briefly was) no rule at all. Defaults to the $3-15M band his
-- method names; null/null means "no limit" so a search can deliberately go
-- broad. Stored per-search so widening the band on one search doesn't change
-- what a previous folder meant.
alter table searches add column if not exists revenue_min_musd numeric;
alter table searches add column if not exists revenue_max_musd numeric;

-- Backfill existing rows to the documented baseline so old folders read
-- consistently with the method rather than looking unbounded.
update searches
  set revenue_min_musd = 3, revenue_max_musd = 15
  where revenue_min_musd is null and revenue_max_musd is null;

comment on column companies.operating_model is
  'Whether the company runs its own crews, subcontracts, or both — step 04 of '
  'the method. Captured for every company; never used as a rejection gate.';
comment on column searches.revenue_min_musd is
  'Lower bound of the target revenue band in $M. NULL on both bounds = no '
  'limit. Defaults to 3 (see the $3-15M band in the stated method).';
