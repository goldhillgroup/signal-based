-- The client's written ICP, updated — wider than the one this was built for.
--
-- Two changes, both widening. Neither drops data and both are safe to re-run.
--
-- 1. companies.other_signals
--    The ICP says plainly: "No single signal proves that the company needs
--    help. Leads should be assigned a confidence score based on the number and
--    quality of the signals found." It then lists twelve observable signals —
--    founder moving to chairman, a next-generation promotion, an announced
--    transition, siblings in executive roles, EOS/Scaling Up, growth, legacy
--    language, and so on.
--
--    Confidence previously rested on ONE test: are two named people from two
--    generations both currently present. That scored a company showing a
--    chairman move, an announced transition and three siblings in executive
--    roles exactly the same as one that merely says "second generation".
--
-- 2. the industry CHECK constraint
--    It allowed only ('landscaping', 'home_builder'). The updated ICP names
--    six more families: construction and contracting; electrical, plumbing,
--    HVAC and specialty trades; manufacturing; distribution; home and property
--    services; and select professional-services firms with several family
--    members involved.
--
--    That constraint is not a preference — it is a hard database rejection, so
--    an electrician with a father and daughter running it together could not
--    be stored even if every other part of the pipeline wanted to keep it.
--    Measured against rows already on disk, 42 companies had been read, paid
--    for and discarded for being a trade the client now asks for.
--
--    Widened rather than dropped: a free-text industry column would let a
--    classifier typo create a vertical nobody searches.

alter table companies
  add column if not exists other_signals text[] not null default '{}';

comment on column companies.other_signals is
  'Supporting succession signals from the ICP''s observable list (founder_to_chairman, next_gen_promoted, leadership_transition, multiple_relatives_executive, growth, ...). Confidence is scored on how many are present, per the client''s ICP.';

alter table companies
  drop constraint if exists companies_industry_check;

alter table companies
  add constraint companies_industry_check check (
    industry in (
      'landscaping',           -- landscaping and outdoor services
      'home_builder',          -- luxury and custom homebuilding
      'construction',          -- construction and general contracting
      'trades',                -- electrical, plumbing, HVAC, specialty trades
      'manufacturing',
      'distribution',
      'property_services',     -- home and property services
      'professional_services'  -- only where several family members are involved
    )
  );

-- The searches table records what a run was FOR, and takes the same vocabulary.
alter table searches
  drop constraint if exists searches_industry_check;
