-- Cross-search memory, so the engine gets smarter instead of repeating itself.
--
-- The problem this fixes: seenDomains was per-RUN only, so re-running
-- "California landscaping" next month re-discovered, re-fetched and
-- re-classified the exact same companies and handed back the same list. That
-- is both wasted spend and useless to the user.
--
-- But "never look again" is equally wrong, and for this product especially:
-- the whole premise is that the signal APPEARS OVER TIME. A founder's daughter
-- joins the business in March; a company that legitimately showed nothing in
-- January becomes a real lead. Catching that moment is the product.
--
-- So the rule is neither "skip forever" nor "rescan everything" — it is
-- RE-CHECK ON A SCHEDULE THAT DEPENDS ON WHY IT WAS REJECTED. A company cut
-- for "only one generation on the page" can change next quarter. A company cut
-- for being an HVAC firm will never become a landscaper.
alter table companies add column if not exists recheck_after timestamptz;

comment on column companies.recheck_after is
  'When this domain becomes eligible for re-classification. NULL = never '
  're-check (qualified leads, or structurally-permanent rejections). Set from '
  'the rejection reason at insert time — see RECHECK_DAYS in '
  'lib/pipeline/recheck-policy.ts.';

-- Discovery filters on (domain, recheck_after) constantly; without this every
-- round does a seq scan over the whole table as it grows.
create index if not exists companies_domain_recheck_idx
  on companies (domain, recheck_after);

-- Lets a search cheaply ask "have we seen this domain at all, and when" across
-- every prior search, not just the current one.
create index if not exists companies_domain_last_crawled_idx
  on companies (domain, last_crawled_at desc);
