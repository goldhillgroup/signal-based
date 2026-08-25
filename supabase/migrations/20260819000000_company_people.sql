-- More than one person per company, and a say in which of them gets bought.
--
-- A company carried exactly two name fields, founder_name and next_gen_name,
-- because the first brief described exactly two people. Real companies do not
-- oblige. A builder has a founder, two sons in the business and a general
-- manager who is not family; a firm has three partners and no successor at
-- all. Jonathan hit this immediately: he found a successor on LinkedIn the
-- site never printed, and separately a company where the classifier had the
-- generations reversed.
--
-- The cost of the old shape was not cosmetic. Enrichment buys an address for
-- `next_gen_name ?? founder_name`, so a company with two sons could only ever
-- have one of them looked up, and which one was decided by whichever the
-- classifier happened to name first.
--
-- WHY A TABLE AND NOT MORE COLUMNS. founder_2_name, next_gen_2_name and so on
-- runs out again on the next company, and every query that wants "the people
-- here" has to know how many columns to check. Rows are the shape the data
-- actually has.
--
-- The company columns STAY. They are what the crawler read off the page, and
-- this file does not touch them: the evidence and the contact list are
-- different things, which is the same reason the quote is not editable while
-- the people are.

create table if not exists company_people (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,

  name         text not null check (length(trim(name)) > 0),
  title        text,

  -- Which generation, so the list can still be read at a glance and so
  -- enrichment has a sensible default when nobody has chosen a target.
  role         text not null default 'other'
                 check (role in ('founder', 'next_gen', 'other')),

  -- Who the next lookup buys an address for. Enforced to at most one per
  -- company by the partial unique index below: two targets is not a state
  -- the enrichment step could act on, so it is made unrepresentable rather
  -- than checked for at runtime.
  is_target    boolean not null default false,

  -- 'crawler' for rows backfilled or written by the pipeline, 'user' for ones
  -- typed in by hand. A hand-typed person is never overwritten by a later
  -- re-crawl, which is the whole point of being able to correct one.
  source       text not null default 'crawler'
                 check (source in ('crawler', 'user')),

  created_at   timestamptz not null default now()
);

create index if not exists company_people_company_idx on company_people (company_id);

create unique index if not exists company_people_one_target_idx
  on company_people (company_id)
  where is_target;

-- Same name twice on one company is a duplicate, not two people.
create unique index if not exists company_people_unique_name_idx
  on company_people (company_id, lower(trim(name)));

-- ── Backfill ──────────────────────────────────────────────────────────────
--
-- Every company that already names somebody gets rows, so the feature is not
-- empty on day one for the 400-odd leads already in the database.
--
-- The target follows the rule enrichment already used: the next generation
-- when there is one, the founder otherwise. Nothing about who gets bought
-- changes for an existing lead until somebody chooses differently.

insert into company_people (company_id, name, title, role, is_target, source)
select id, trim(next_gen_name), next_gen_title, 'next_gen', true, 'crawler'
from companies
where next_gen_name is not null and length(trim(next_gen_name)) > 0
on conflict do nothing;

insert into company_people (company_id, name, title, role, is_target, source)
select c.id,
       trim(c.founder_name),
       c.founder_title,
       'founder',
       -- Target only when no next-gen row already claimed it.
       not exists (select 1 from company_people p where p.company_id = c.id and p.is_target),
       'crawler'
from companies c
where c.founder_name is not null and length(trim(c.founder_name)) > 0
on conflict do nothing;

-- ── Which person an address belongs to ────────────────────────────────────
--
-- Nullable: every contact row predating this has no person attached, and a
-- general inbox never belongs to one. Enrichment sets it when it buys an
-- address for a named person, so "have we already looked this person up" is
-- answerable per person rather than per company. Without it, buying an
-- address for the second son would look like the company was already done.

alter table contacts
  add column if not exists person_id uuid references company_people (id) on delete set null;

create index if not exists contacts_person_idx on contacts (person_id);

grant select, insert, update, delete on company_people to authenticated, service_role;
