-- Search mode — decouples "is this company in my ICP" from "does it show a
-- succession signal." Before this migration the pipeline only had one gate
-- (orchestrator.ts required classification.qualifies, which the classifier
-- only ever sets true when it finds a real founder/next-gen succession
-- signal) — so a plain "give me landscaping companies in Texas" request was
-- structurally impossible to satisfy: every candidate without an active
-- signal got rejected regardless of how good a category/size/ownership fit
-- it was.
--
-- Three modes:
--   'signal' — current behavior, unchanged. A company only counts if the
--     classifier finds a real succession signal (plus passes size/ownership).
--   'filter' — category + region + size + ownership fit is enough. No
--     signal required at all. "Get me landscapers in Texas" now just works.
--   'hybrid' — same acceptance bar as 'filter' (nobody is rejected purely
--     for lacking a signal), but every accepted company is still tagged
--     with whether a signal was found, and results rank signal-bearing
--     companies first. Same pattern used on the Ofer Lieberson project:
--     deliver the full qualifying set, but the real triggers surface first.

alter table searches add column if not exists mode text not null default 'signal'
  check (mode in ('signal', 'filter', 'hybrid'));

-- 'filter'/'hybrid' accept companies with no signal at all — this is the
-- live counter for those (parallel to qualified_count/verify_count, which
-- both always mean "a signal was found," in every mode).
alter table searches add column if not exists fit_only_count integer not null default 0;

-- Two-step flow (2026-08-06, for testing): discovery/classification runs and
-- shows results on its own; contact enrichment (Anymailfinder +
-- MillionVerifier) is now a separate, manually-triggered step — a button on
-- the results page, not something that runs automatically as part of the
-- search. This tracks that second step's own lifecycle independently of
-- searches.status (which only ever describes discovery/classification).
alter table searches add column if not exists enrichment_status text not null default 'idle'
  check (enrichment_status in ('idle', 'running', 'complete', 'failed'));
alter table searches add column if not exists enrichment_error text;

-- Whether THIS company showed a real succession signal, independent of
-- whether the search's mode required one. Always set in 'signal' mode
-- (redundant with status/confidence there, kept for query consistency).
-- Populated in 'filter'/'hybrid' too whenever the classifier happens to spot
-- one — a fit_only company earns nothing extra for it except in 'hybrid'
-- ranking, but the fact is still worth capturing for the record.
alter table companies add column if not exists has_signal boolean;

-- Which discovery channel actually surfaced this company — useful once a
-- third (directory) channel exists alongside maps/web-search, both for
-- debugging yield per channel and so the UI can show "found via CSLB
-- license board" rather than an opaque source_url.
alter table companies add column if not exists discovery_channel text;
