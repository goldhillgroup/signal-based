# Where Signal Radar is

Written 14 August 2026, with the update below added 13 October 2026. Every number
in the August sections was read from the live system or the live vendor APIs.
The October update says, item by item, which numbers were measured and which are
reasoning.

---

## Update, 13 October 2026: Jonathan's four issues, and speed

Jonathan reported four problems after two days of use. Each was traced to its
cause before anything was changed. **Measured** means read from the live database
that day. **Not yet proven live** means the change is tested in isolation and
reviewed, but no real search has been run through it, because a real search
spends the client's vendor credits. The first one after this goes out should be
watched.

### 1. "Results may be incomplete" kept appearing

Three separate causes, none of them the search being incomplete:

- A trade or state with **no public licence list** (most of them) was reported as
  the licensing channel having *failed*. It now says nothing, because there was
  nothing to search.
- A channel that failed for **some states only** ("Web search failed for CA/NY")
  was not understood by the banner and printed as "A discovery channel failed".
- **One timeout** in a four-call search raised the same banner as a dead vendor.

The banner now appears only when **web search or Google Maps** was unavailable in
at least half of a pass's discovery calls, or when no channel could search at all.
Directories and licensing boards being quiet no longer raises it.

### 2. A target of 50 returned 2 or 3 leads

The ceiling was 240 companies read per search. A confirmed pair turns up about one
read in thirty (**measured**: web search 1 in 33), so 50 pairs needs ~1,500 reads.
The request was unreachable however well the run worked, and the dialog said so
only in small print. Also found, **measured**:

- 205 of the 209 companies due for a re-check were **dead or bot-blocked sites**.
  Nothing moved their date forward, so the same few came back on every search:
  three of them were re-read in 9 of the last 10 searches.
- They were queued *ahead* of fresh discovery, and a dead site is the slowest read
  in the pipeline. **Five of the last twelve searches spent their entire
  four-minute pass on eleven re-reads and read nothing new.**
- Re-reads were counted as new ground and as fresh rejections even when the row
  already existed, so a run reported 66 companies scanned against a folder holding
  eleven, and that inflated count stopped the search.

What changed: a search may now read up to **1,000 companies** (it was 240); the
choices are 10, 20, 50, 100 and 200; re-checks go **behind** new ground, at most 8
per pass and a small share of the read budget, judged companies before dead sites,
and each is moved on when read; counters move only for rows that exist; passes
carry on by themselves (up to 14), and a finished folder that stopped short shows
**Keep searching**, which picks up where it stopped.

**Honest expectation:** the form now says what the arithmetic says, "expect about
N confirmed pairs, plus the good family-owned companies found on the way". A target
of 50 pairs will usually return fewer than 50 pairs. That is a real event in the
world, not something more spending conjures. Not yet proven live.

### 3. Duplicate leads when combining exports

**Measured:** 110 domains were stored in more than one row, 14 of them as a
*qualified lead in several lists*, one company eleven times. A company is stored
once per folder by design, and re-checks had been inserting it again every time.

- **At the source:** a lead already on another list is not added again (one
  exception: a fit-only lead that has since grown a real founder-and-successor pair
  replaces it); a re-check that is still a "no" stores nothing.
- **In the exports:** the combined CSV, Excel and Google Sheets copy keep **one row
  per company**, the strongest one, with no address or note lost, and an
  `also_in_lists` column naming the other lists. Lead Lists says "171 leads (148
  different companies; 23 are in more than one list)", so the shorter file is
  explained rather than looking like lost data. Verified on the real data: the
  combined file has 148 rows and 148 distinct domains.
- **What is already stored:** `scripts/dedupe-companies.mts` removes it. It is
  **plan-only by default** and has not been applied. Current plan: 27 domains,
  **23 duplicate lead rows and 98 duplicate cut rows**, 8 addresses moved onto the
  surviving row, notes and 1-5 grades carried over, 20 folders recounted. Apply
  with `npx tsx scripts/dedupe-companies.mts --write`.

### 4. Co-owners missing, when the primary owner has no email

Four gaps, all real:

1. The page classifier returned two people, the founder and the successor. A page
   naming three brothers, or a husband and wife, or a managing partner beside the
   founder, produced two names. It now returns up to four more people, stored on
   the company, and **only owners, executives and relatives are kept**. That last
   rule came from running the real model on realistic pages (about 13 cents):
   asked to leave staff out, it still listed a dispatcher, a crew leader and an
   operations manager from a "Staff" section. The prompt is now stricter, and the
   code keeps a person only if their title says they own or lead the business or
   the page ties them to the family, so an unfinishable list of staff words is no
   longer the safety net. On the three test pages the result was: a father and three
   children gave the two other siblings; a husband-and-wife firm gave the wife and
   none of the four staff; a sole owner gave nobody.
2. Enrichment bought an address for **one** person and, if that came back empty,
   settled the company for good. It now tries the other listed people (up to three
   more) when the first lookup found nothing, or only a company-wide mailbox rather
   than a person. The vendor bills **only when it finds an address**, so a miss
   costs nothing; the extra cost is at most one more found address per company.
3. An address on the page beside a co-owner's name was filed as an anonymous inbox,
   and on promotion every parked address took one person's verification result.
   Each is now matched to the right person and verified on its own.
4. Lists, cards and exports showed one personal contact per company. They now show
   "+N more owners" and the CSV, Excel and Sheets carry `contact_2_*` and
   `contact_3_*` columns (hidden when empty).

**Not done:** companies already in the database were not re-read for co-owners.
That needs a model call per company (about 1 cent each) and is the client's money;
it is a small backfill script if wanted.

**A finding worth acting on, not yet acted on:** one real classify call was 9.6 s
and $0.011, and 416 of its 861 output tokens were the model's hidden reasoning.
Output tokens are the slow and expensive part, so limiting the reasoning could cut
classify time and cost by something like a third. Separately, one of five test calls
came back EMPTY on both the 2,400 and the 4,000-token budgets (`finish_reason:
length`), which looks like the reasoning running away with the budget; the code
already comments that this loses about 1 company in 5 on some runs. Neither has been
changed, because the verdicts were tuned with reasoning on and changing it needs a
measured comparison on the eval set (about $3), which is the client's money.

### Faster and smoother

**Measured**, against the real data, on a production build:

| | Before | After |
|---|---|---|
| Lead Lists first load | 780 KB, every company with every contact | **31 KB**, one query |
| Folder tiles visible | after the whole 780 KB | **~0.55 s** |
| Opening a folder | already loaded | **~0.2 s** (35 KB) |
| Returning to Lead Lists | full reload | **~50 ms**, refreshes behind |
| Activity feed | 4-6 requests per page, every contact column | one, three columns, cached 30 s |

Every list read now pages through the database's 1,000-row cap instead of silently
dropping the oldest rows once a table passes it (the companies table is at 1,668
rows and a folder can now hold 1,000).

**Search itself was waiting on discovery, not on reading.** Measured on the real
vendors (one Texas landscaping round): the directory answered in 12 s, Google Maps
in 12 s and **web search in 68 s**, and the round yielded about 19 candidates,
roughly 35 seconds of reading for eight workers. A round at a time kept the workers
busy about half the time, which is why a pass read 40 to 60 companies however well
the reading was tuned. Splitting web search into parallel calls does not help (one
query alone took 30 to 78 s); the vendor's latency cannot be shortened, only hidden.
Three changes:

1. **Reading starts as soon as web search is back**, and the slower channels'
   candidates join the back of the queue when they land. Nothing is dropped, and a
   channel that never answers no longer holds the pass.
2. **The workers share one queue** instead of taking 32 companies at a time, so none
   waits behind the last slow site of a batch.
3. **Discovery rounds overlap.** Up to three are in flight, and another is bought
   whenever the queue plus what is already on its way would run short, judged by how
   long rounds are actually taking in that run. Every limit still applies (time, the
   money ceiling, the read ceiling, the target), and a round that comes back empty
   or failed stops the top-ups until the loop has dealt with it.

Each channel's real answer time is now logged ("[discovery round 7] Web search 28
results after 67.5s"), so production logs show what the vendors take.

**Measured on a simulation of those real latencies** (`scripts/sim-run.mts`, which
runs the real pipeline and the real database against fake vendors, so it costs
nothing and two versions of the code can be compared on identical conditions). One
pass, same world each time:

| | Companies read in one pass |
|---|---|
| Before these changes | 40 |
| Reading starts early, one shared queue, one background round | 60 |
| Rounds overlap (now) | **98** |

The original's 40 sits inside the 40 to 60 companies per pass seen in the real
history, which is what makes the model credible. Also exercised: Maps failing
(reported once, as a warning), web search failing (Maps' candidates are read
instead), a channel that never answers (the pass still ends cleanly), every vendor
out of credit (ends with "Could not search" and the reason), and an empty pool
(declared dry after four empty rounds). **The ratio is meaningful; the seconds are
not a promise.** Cost per company read is unchanged; a pass buys more discovery
rounds (a round is about 3 cents), so cost per pass rises with the work done.

**Checked on the real vendors** (about $0.50 of the client's credit in all):

- One end-to-end search, `scripts/e2e-run.mts --mini` (filter mode, target 2, a state
  with nothing on file): status complete, 12 companies read, 4 leads kept, 8 cut,
  **$0.32**. The folder was removed afterwards and the companies kept as memory.
- Five real classifier calls on realistic pages, which found and fixed two problems
  in the co-owner list (staff leaking in, and historical founders being listed).
- One discovery-only round, which produced the latencies above.

**Not yet checked on real vendors:** the overlapping-rounds pipeline at full scale
(it is verified on the simulation and in pieces), so the first full search after a
deploy should be watched. A Google Maps call still running when a pass ends is billed
but not counted in that pass's cost estimate. The seconds-per-company figure that
sizes "about N passes" on the form (2.6) is still an estimate.

**Co-owners for the leads already on file** (`scripts/backfill-co-owners.mts`, run
2026-10-13): 148 companies, 124 read, **46 had other owners named, 74 people added**,
3 addresses attributed to the right person, **$1.36** for the classifier calls.
17 were skipped because the site would not load without a paid render, and 4 failed
with the model's empty-answer problem; re-running the script retries only those. It
buys no addresses: finding emails stays the separate, confirmed step.

### Things worth knowing

- `.env.local` has a stray `ho` before its first key (`hoNEXT_PUBLIC_SUPABASE_URL`).
  Left alone. Local builds read the Supabase URL as empty because of it; Vercel uses
  its own settings, so production is unaffected.
- The sidebar's "180 leads found" adds up each folder's own counter, which had
  drifted from the rows (171 leads actually on file). Applying the cleanup script
  recounts them.
- A Google Maps call still running when a pass ends is billed by Apify but not
  counted in that pass's cost estimate.

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
reads the database first. Only three variables belong in Vercel: the
Supabase ones.

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
