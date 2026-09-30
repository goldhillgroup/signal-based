# Accounts and subscriptions

Every service Signal Radar depends on, what it costs, and who is currently
paying for it. Balances below were read live from each vendor's own API on
**11 August 2026** — they are a snapshot, not a promise. The Settings page in
the app shows the same numbers, always current.

The account email for the Gold Hill side is **thegoldhillgroup@gmail.com**.

---

## The short version

| | |
|---|---|
| Fixed monthly cost | **$29** (Apify) |
| Everything else | pay-as-you-go or free tier |
| Measured cost of a search | **~$0.02 per company read**, ~$0.09 per lead found |

Nothing here bills automatically except Apify. The rest is prepaid credit that
simply runs out — which is worth knowing, because a vendor running dry looks
like "the search found nothing", not like an error.

---

## Free — no card, no renewal

| Service | Plan | What it does |
|---|---|---|
| **GitHub** | Free | Hosts the code at `goldhillgroup/signal-based`. Hosts the code. |
| **Vercel** | Hobby | Hosts the app at `signal-based.vercel.app`. The 300-second function limit is a Hobby constraint and the code is written to live inside it; see `docs/DEPLOY.md`. |
| **Supabase** | Free | The database and the login. Free tier covers this comfortably — the whole dataset is ~530 rows. |

**Do not upgrade Vercel to Pro for this.** It was considered and rejected: Pro
raises the function limit to 800 seconds, which still is not enough for a large
search, and the app already handles the limit by running in passes. See the
commit "No Pro: 300s everywhere".

---

## Paid — real money

### Apify — $29/month, the only fixed cost
Finds companies through Google Maps and web search, and fetches pages other
methods cannot reach. **Nothing runs without it** — no Apify token means no
search at all.

There are two accounts and this matters:

- **Jonathan's own** (`APIFY_TOKEN`) — $29/mo plan, $9.02 used, resets 3 Sep.
  This is the one that should be in use in production.
- **A developer account** (`APIFY_TOKEN_4`) — used during the build so testing
  did not bill the client. $10.80 of a self-imposed $14 cap.

`getApifyToken()` tries `APIFY_TOKEN_4` **first**. So if that variable is ever
set in Vercel, Jonathan's searches quietly bill the developer account and stop
dead at $14 instead of using his own $29 plan. **It must not be set in
production.**

### OpenRouter — prepaid credit
Runs the classifier: reads each company page and decides whether it shows a real
founder-to-next-generation succession signal. Two calls per company.

**$16.96 of $20.00 used — 85%.** The key currently in Settings belongs to a
developer, not to Gold Hill. Two things follow:

1. It will run out soon, and when it does searches will return nothing rather
   than showing an obvious failure.
2. Until it is replaced, someone else is paying for Jonathan's searches.

**Action: create an OpenRouter account under thegoldhillgroup@gmail.com, add
$50, and paste the key into Settings.** $50 is roughly three years of monthly
harvests — the entire build, including every test run, cost $17.

### Firecrawl — 1,025 credits left, renews 11 Sep
Fetches company pages, including JavaScript-rendered sites that a plain request
cannot read. Roughly one credit per page.

### Tavily — 1,000 credits/month, 1 used
Finds industry directories and association member lists. The free tier has been
more than sufficient.

### AnymailFinder — 365 credits
Finds the email address for a named person at a company. **Only billed when an
address is actually found**, so the cost scales with results rather than
attempts. ~$0.05 per found address.

### MillionVerifier — 10,477 credits
Checks whether a found address is deliverable before it reaches the call list.
~$0.006 per check. Prepaid; the balance only moves when you buy more.

---

## Where the keys actually live

**Not in Vercel.** All six vendor keys are stored in the app's own database and
managed from the **Settings** page, so Jonathan can rotate any of them himself
without a redeploy.

`resolveSetting()` reads the **database first**, environment second. A key saved
in Settings therefore overrides anything in Vercel — which is the intended
behaviour, and also a trap: during the migration the database still held the old
Tavily and Firecrawl keys and silently ignored the new ones in the environment.
If a vendor ever behaves unexpectedly, **check Settings before checking Vercel.**

Only four variables belong in Vercel, because the app must reach the database
before it can read anything out of it:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

---

## Logging in

```
https://signal-based.vercel.app/login
```

Two real Supabase accounts, both working, same password:

- `jonathan@thegoldhillgroup.com`
- `thegoldhillgroup@gmail.com`

Plus two ALIASES (lib/login-aliases.ts) that sign into the first account above
without being separate Supabase users -- the typed address is rewritten to
`jonathan@thegoldhillgroup.com` right before the call to Supabase, so there is
still exactly one password to keep current:

- `jon@thegoldhillgroup.com`
- `d4nielm7@gmail.com`

Passwords are managed in Supabase → Authentication → Users, or he can reset
his own via **"Forgot password?"** on the login page.

REBUILT, not the original version. An earlier one called resetPasswordForEmail
and never looked at the result, so it claimed "Email sent" whether or not one
actually was -- Supabase's mailer is rate-limited and can be slow or silent,
and a control that always claims success just cost him twenty minutes of
checking spam. This one shows the real error when the request fails, and is
honest that delivery can still be slow even on success.

**One thing to check in Supabase if the emailed link 404s or bounces back to
login with "that reset link didn't work":** Authentication → URL
Configuration → Redirect URLs needs `https://signal-based.vercel.app/auth/confirm`
in the allow list, or Supabase will refuse the redirect the email link
depends on. I could not confirm this is set -- this machine has no network
route to Supabase's API to check it directly, only through the deployed app.

---

## What to do next, in order

1. **OpenRouter key.** At 85% and owned by the wrong person. This is the only
   item that will actually break something if ignored.
2. **Check `APIFY_TOKEN_4` is absent from Vercel's environment.** If it is
   present, the wrong account is being billed and searches stop at $14.
3. **Rotate the keys** that were shared during handover — the Supabase keys and
   the login password.
