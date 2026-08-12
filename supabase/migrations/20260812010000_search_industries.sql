-- A search can now target SEVERAL verticals at once.
--
-- "Landscaping and HVAC" is a reasonable thing to ask for and used to require
-- two separate runs, two folders, and two lots of discovery spend over the same
-- geography. The ICP names eight verticals; making them mutually exclusive at
-- search time was an artefact of there having been two.
--
-- An empty array means every vertical.
alter table searches
  add column if not exists industries text[] not null default '{}';

comment on column searches.industries is
  'Verticals this search targeted. Empty means all eight.';

-- No backfill: `searches` never had a singular industry column. A folder's
-- vertical was inferred by SAMPLING its companies, which worked only because a
-- run could target exactly one. Older rows keep an empty array, which reads
-- correctly as "every vertical" and matches what those searches actually did
-- when the ICP had two.
