-- The phone number Google Places already returns for every place we pay for.
--
-- Every Maps discovery response carries the business phone alongside the
-- website URL, in the same $0.004 record, and it was being dropped on arrival.
-- For this ICP that is the wrong thing to drop: the target is a founder in his
-- sixties running a landscaping company, and a phone number is frequently the
-- contact that actually gets answered. It also costs nothing extra — no vendor
-- call, no lookup, no enrichment credit.
--
-- Written by a separate best-effort UPDATE after the company insert, never
-- folded into the insert itself, so a database without this column loses a
-- phone number rather than losing the company.
alter table companies add column if not exists phone text;

-- The street address, from the same Places record. City alone answers "is this
-- in my territory"; the street line answers something the ICP actually turns
-- on — a landscaping company with a yard and crews has a commercial address,
-- and a one-man operation run from a house has a residential one. That is the
-- difference between a business with a succession problem and a sole trader
-- with none.
alter table companies add column if not exists address text;

comment on column companies.phone is
  'Business phone from the Google Places discovery response. Free, captured at discovery, never from a paid lookup.';

comment on column companies.address is
  'Street address from the Google Places discovery response. Free, captured at discovery.';
