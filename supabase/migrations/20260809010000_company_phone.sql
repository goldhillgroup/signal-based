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

comment on column companies.phone is
  'Business phone from the Google Places discovery response. Free, captured at discovery, never from a paid lookup.';
