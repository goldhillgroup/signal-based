# Deploying

Live at **https://signal-based.vercel.app**, from `goldhillgroup/signal-based`
on Vercel's Hobby plan.

---

## Environment variables in Vercel — only four

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET
```

`NEXT_PUBLIC_*` are visible in the browser, which is correct — the anon key is
designed for that and row-level security is what protects the data. The
service-role key must **never** be given a `NEXT_PUBLIC_` prefix; it bypasses
RLS entirely.

`CRON_SECRET` can be any long random string. Without it the monthly harvest
endpoint returns 503 and refuses to run, rather than defaulting open — an
unauthenticated endpoint that spends money on every GET is the one failure mode
that must not be reachable by accident.

### The six vendor keys do NOT go here

OpenRouter, Apify, Tavily, Firecrawl, AnymailFinder and MillionVerifier live in
the database and are managed from the app's **Settings** page, so they can be
rotated without a redeploy.

`resolveSetting()` reads the **database first**, the environment second. A key
saved in Settings overrides anything in Vercel. That is intended — and it is
also a trap worth knowing: during the migration the database still held the old
Tavily and Firecrawl keys and silently ignored the new ones in the environment,
so a key that looked correct everywhere was not the one being used.

**If a vendor misbehaves, check Settings before checking Vercel.**

### One variable that must be ABSENT

**`APIFY_TOKEN_4`.** It is a developer account with a self-imposed $14 cap, and
`getApifyToken()` tries it *before* the client's own token. If it is set in
production, Jonathan's searches bill the wrong account and stop dead at $14
instead of using his $29 plan.

---

## Why the app is written for 300 seconds

Vercel's default function limit is 300s on every plan. Pro with Fluid compute
allows 800s — and **that is not worth buying here**, for two reasons:

1. 800s still does not fit a large search. At a measured ~5.2s per company, 300s
   reads about 57 companies and 800s reads about 150; a target of 100 needs 240.
2. The app already handles the limit properly. A run watches its own clock,
   stops cleanly before the platform kills it, saves everything found, and the
   progress dialog automatically starts the next pass. A target of 100 completes
   in several passes with one press of Search.

Setting `maxDuration` above the plan's ceiling does **not** clamp — it fails the
build. So the value is 300 everywhere, in three routes plus `RUN_CEILING_MS` in
`lib/pipeline/reap.ts`. **All four must move together** or the reaper starts
closing out runs that are still writing.

---

## The monthly harvest

Currently **off**, and it should stay off until the product is in regular use —
it costs ~$61/year and produces folders whether or not anyone opens them.

When it is wanted, it runs from **GitHub Actions**, not from Vercel: a job there
may run for six hours, so a full harvest actually finishes. `vercel.json` has no
cron block on purpose — at 300s it could only ever half-finish a harvest, and
because the run claims the month before crawling, a half-run would still consume
it.

To switch on: add the vendor keys as repository secrets, then Settings → Monthly
harvest → on. The Actions tab has a **Run workflow** button that defaults to a
dry run, so it is safe to press just to confirm it is wired up.

---

## Database changes

Migrations live in `supabase/migrations/` and are applied in filename order.
There is no CLI path — `db.<ref>.supabase.co` publishes no A record, so direct
connections fail. Two options:

- paste each file into the Supabase SQL editor, in order, or
- connect through the **pooler** (`aws-0-<region>.pooler.supabase.com:5432`,
  user `postgres.<ref>`) with the database password, which does resolve on IPv4.

`20260811000000_grants.sql` must be applied to any new project. Without it every
table exists, RLS is correct, and every request returns `42501 permission
denied` — PostgREST connects *as* `anon`/`authenticated`/`service_role`, and
with no grant, RLS is never even consulted.

---

## After any deploy, check these three

1. `/login` renders and accepts a real account.
2. `/api/cron/weekly` returns **401** without a header — proves `CRON_SECRET` is
   set and the guard works. A 503 means it is missing.
3. Settings shows vendor balances. If they are blank, the keys are not
   resolving.
