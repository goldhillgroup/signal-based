# Where Signal Radar is

Written 14 August 2026. Every number here was read from the live system or the
live vendor APIs, not estimated.

---

## In one line

It works end to end, nothing false reaches the sheet, and it produces a good
call list and a thin pair list. It is better at being trustworthy than prolific.

---

## The accounts — one key per vendor, nothing borrowed

| Vendor | Account | State | Notes |
|---|---|---|---|
| **OpenRouter** | `…2Yw5t4` | **$49.94 of $80 left**, key uncapped | Judges every page. Two calls per company. |
| **Apify** | org token, `able_quadruplet` | **$9.52 of $29** this cycle | Finds companies, fetches pages. Nothing runs without it. |
| Firecrawl | client's | ~1,025 pages/month | Renders JS-heavy pages. |
| Tavily | client's | 1,000/month, barely used | Finds directories only. |
| AnymailFinder | client's | 365 credits | Billed **only on a hit**. |
| MillionVerifier | client's | 10,477 credits | Checks an address is deliverable. |

**Two borrowed accounts were removed today**, and the code paths deleted rather
than the variables unset:

- `APIFY_TOKEN_4` — a developer's own Apify account, which `getApifyToken()`
  tried **first**. Every search had been billing it.
- `OPENROUTER_API_KEY_2` — a second OpenRouter key used automatically on a 402,
  with a $5 cap and a baseline row to police it.

`tests/apify-account` walks the whole tree and fails if any non-comment line
reads either one, so they cannot come back by pasting an env file.

**Keys live in the database** (Settings page), not in Vercel. `resolveSetting()`
reads the database first. Only four variables belong in Vercel: the three
Supabase ones and `CRON_SECRET`.

---

## What is in the database

| | |
|---|---|
| Leads | **393** (365 found by the crawler, 28 Jonathan's own hand-audited) |
| Confirmed founder + successor pairs | **48** |
| With a phone number | **94%** |
| With a full, searchable name | 49% |
| With an email found | 6% — *enrichment has barely been run* |
| Nothing but a company name | **2%** |
| Companies judged in total | ~1,050 (all remembered, none re-paid for) |

---

## How good the leads are

**As a call list: good.** 94% have a phone, half name a person, 2% are dead
weight. Every claim on a row was checked against the page it came from — quotes
are verified in code, confidence labels that are not supported get lowered, and
"no information" does not count as a fit.

**As a succession-signal list: thin.** 48 pairs from ~1,050 companies read.
That is roughly **1 pair per 33 companies** on the best channel, and it is the
number the product is named after.

For comparison, Jonathan's own hand-auditing runs at about 1 in 2.4. The machine
will not approach that. What it offers is that it never stops and always shows
the receipt.

---

## Discovery, and where the budget goes

Measured on this installation's own history:

| Channel | Read | Pairs | Rate |
|---|---|---|---|
| **web_search** | 496 | **15** | 1 in 33 |
| maps | 343 | 2 | 1 in 172 |
| directory | 159 | 0 | never |

The read budget was rebalanced on 14 Aug: **web search 2×, Maps and directories
a 0.35× floor.** Maps had held a bigger share because it was the only channel
returning a phone number and a city — that stopped being true once page contact
details started being read out of the footer, and web-search leads now reach 93%
phone coverage against Maps' 100%.

Projected on those rates: **+29% pairs for +7% reading, phone coverage
unchanged.** That is arithmetic over real history, **not yet confirmed by a live
result** — a single run cannot distinguish 1.93 from 2.34 pairs per 100.

Verified live: the mix now runs **web_search 71% / maps 24% / directory 5%.**

---

## The last live run

Landscaping · Massachusetts · target 5, through the real app.

```
21 companies read   8 leads   13 cut   $0.428
web_search 71%   maps 24%   directory 5%
6 of 8 leads carry a phone
7 of 8 carry a supporting signal
   6 generation_language · 2 legacy_language · 1 founder_to_chairman
```

Graded: **clean — nothing unconfirmed reached the sheet.** No unclean bands or
titles, no stitched quotes, no pair missing a person, no unearned confidence
label, no debug text in a rejection reason, and none of the 5 withheld rows
named both people.

Zero confirmed pairs in that run, which is what 21 reads predicts at 1 in 33.

---

## Costs

| | |
|---|---|
| Reading one company | **$0.019** focused, **$0.037** wide (8 verticals × 12 states) |
| A target-5 search | ~$0.45 |
| Finding one email | $0.056, **billed only when found** |
| Enriching all 359 waiting leads | ~$20 |
| Fixed monthly | **$29** (Apify). Everything else is prepaid or free. |

Nothing spends without asking. The search form and all three enrichment entry
points confirm first, with the cost on the dialog.

---

## What is known about each lead

Jonathan's written ICP, and whether the system captures it:

| Criterion | Captured? |
|---|---|
| Family-owned, 2nd/3rd generation | ✅ gated — "no information" is not a fit |
| $5–30M revenue | ⚠️ known for 25% |
| **25–150 employees** | ✅ **fixed today** — was being nulled on write |
| 15+ years operating | ❌ classifier answers it, no column to store it |
| US, CA / NY+Northeast / FL / TX | ✅ 12 states |
| Eight priority verticals | ✅ all eight |
| Next-gen is the primary contact | ✅ enrichment targets the successor first |
| 12 observable signals | ✅ collected on every page |

---

## Known gaps, in the order I would fix them

1. **Enrichment has barely been run.** 359 leads waiting, all with the domain
   the lookup needs, and all 40 waiting pairs have full names for *both* people.
   ~$20 turns "companies to research" into "people to contact".
2. **The +29% is a projection.** It needs a few hundred more reads before the
   pair rate can be compared honestly.
3. **`yearsInBusiness` has nowhere to go.** Needs one migration pasted into the
   Supabase SQL editor.
4. **The employee count will not backfill** — only rows crawled from now on.
5. **All 163 tests are pure-function tests.** None touch the database, an API
   route or the browser — and every significant bug found on 13–14 Aug was found
   by driving the real system, not by the suite. Three or four integration tests
   would be the highest-value engineering work left.

---

## Deployment

Live at **signal-based.vercel.app**, from `goldhillgroup/signal-based` on
Vercel's Hobby plan. A run stops itself before the 300-second function limit,
saves everything, and the next pass starts on its own. Large targets take
several passes and say so on the form.

Login is managed in Supabase → Authentication → Users.
