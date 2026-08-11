# Signal research — what would make this find more, and cheaper

Measured against the live database on 2026-08-09. Every number here came from
a query or a paid test run, not from an estimate.

---

## 1. The finding that matters most

Yield per discovery channel, counted off every company in the database:

| channel | read | signals | rate |
|---|---|---|---|
| **hand audit** | 67 | 28 | **1 in 2** |
| web search | 48 | 2 | 1 in 24 |
| maps | 69 | 1 | 1 in 69 |
| directory | 20 | 0 | none yet |
| licensing | 1 | 0 | none yet |

**The manual method is far better than either automated channel.** The exact
multiple is not knowable from this table — see the correction below — but the
direction is not in doubt.

> **Correction, added after adversarial review.** The web-vs-maps comparison in
> this table rests on **3 signals total** (web 2/48, maps 1/69). Fisher's exact
> two-sided p = **0.57**: at these counts the two channels are not
> distinguishable, and quoting "2.9x" or "34x" from this table alone is wrong.
>
> The comparison survives for a different reason. `channel-priors.ts` carries a
> **disjoint earlier sample** of 195 companies from before the database was
> cleared — web 8/38, maps 3/98, p = 0.0017. Pooling the two independent
> samples: **web 10/86 (11.6%) vs maps 4/167 (2.4%), p = 0.0062, ratio 4.9x**.
> That is a same-direction replication of a pre-registered ordering, which is
> real evidence — but it is one that `orderByYield` already acts on.

That gap is not because a person is cleverer than the classifier. It is because
of *what each one searches for*:

- Maps asks **"who is a landscaper in Houston"** — a category. Family
  succession is orthogonal to that, so the hit rate is whatever the base rate
  of succession happens to be. Measured: 1 in 69.
- The hand audit asked **"who is talking like a handover happened"** — the
  signal itself. Measured: 1 in 2.

This is the scope document's own conclusion, now confirmed with numbers:
*query the signal, not the category.*

### What follows from it

Maps is **46% of a run's cost** and returns the worst measured rate.

> **Correction.** An earlier version of this section said 39% and put web search
> at 10%. Both were wrong: it priced a SERP page at $0.010 when
> `cost-tracker.ts:46` charges **$0.0035**. Repriced against the real table, a
> $0.2605 run is maps 46%, classify 28%, tavily 12%, extract 6%, SERP **4.0%**,
> firecrawl 4%. The error overstated the cost of the channel to expand and
> understated the one to cut.

The strongest argument for cutting Maps is not the yield table at all, and it
holds even if that table is deleted. **Maps bills at buy time and is consumed at
read time, with nothing connecting the two:**

- `recordCost("apify_maps_place", items.length)` fires on everything returned,
  and only *then* does `.filter(place => place.website)` run. A place with no
  website can never become a candidate, because the pipeline reads a company's
  own About page. Those are paid for and immediately discarded.
- `orderByYield` sorts maps behind web_search, licensing and directory. It
  reaches the front only through the 25% exploration reserve.
- A target-3 run reads at most 18 companies across four channels, while one
  discovery call already buffers far more web candidates than that. The surplus
  is dropped at run end, and Maps has no offset parameter, so the next run
  re-buys the same places.

There were **4 query sets, 12 phrasings** for landscaping; now 8 and 24. The
hand audit found 28 signals by searching this way. Rotation is per SET, so extra
sets buy genuinely new SERPs on later rounds rather than lengthening any single
call — 3 pages at $0.0035 each, and only when a round needs more candidates.
Set 1 is left byte-for-byte; it is annotated as the proven one.

---

## 2. Is there a family-business database to buy?

**No.** Checked directly, and the answer confirms the premise the whole product
rests on.

| what exists | what it actually is |
|---|---|
| [FamData (ifo Institute)](https://www.ifo.de/en/ebdc-dataset/famdata-database-research-family-businesses-2023) | German, academic, survey-based, research access only. Not US, not an API. |
| [OpenCorporates](https://blog.opencorporates.com/2025/10/28/opencorporates-api-plus-relationships-file/), [Moody's](https://www.moodys.com/web/en/us/kyc/solutions/entity-ownership.html), [Parent Company API](https://parentcompanyapi.com/) | Corporate *hierarchy* — parent/subsidiary/beneficial owner, for KYC and compliance. Tells you who owns a company, never whether a founder's daughter is being handed it. |
| [Private company databases](https://www.dakota.com/resources/blog/the-top-private-company-databases) | Firmographics and financials. Same filters Apollo and ZoomInfo already have. |

Nobody sells "family-owned with a visible successor" because it is not a field
anyone collects. It is a thing companies *say about themselves in prose*, which
is why it has to be detected rather than filtered — and why three agencies
failed before this.

**Recommendation: buy nothing here.** There is nothing to buy.

---

## 3. State business registries — tested, mostly a dead end

The idea was strong: if a state publishes company *officers*, then two officers
sharing a surname is surname clustering from **structured data**, which would
catch family businesses whose website says nothing at all.

Tested [`great_pistachio/us-business-search`](https://apify.com/great_pistachio/us-business-search)
live, against companies from the hand audit.

**It finds the right company.** Searching "Grasshopper Gardens" in NY returned
`GRASSHOPPER GARDENS, INC.`, active, formed 2000-12-27 — correct.

**It returns no officers for New York.** `officers: []` on every record. NY's
public registry does not publish them; the actor's officer support is real but
state-dependent, and it does not cover the state that matters most here after
California.

What it *does* give cheaply is `formationDate` — the "40+ years old" supporting
signal — at $0.004 per lookup. That is the same price as a Maps place for a
signal the classifier already infers from "serving families since 1962" on the
page, for free. **Not worth wiring in.**

One caution learned the expensive way: this actor bills **per result** and
defaults to 100. A first call with the wrong input field name ignored the query
and returned 100 unrelated records, twice — about **$0.80 for nothing**. Any
pay-per-result actor needs `maxResults` set explicitly, and the input schema
read before the first call, not after.

---

## 4. Signals worth adding, ranked by evidence

### A. More succession phrasings — free, highest return
The channel already proven best is under-supplied: 12 phrasings against a
market the hand audit mined far more deeply. Adding sets costs one SERP page
each, only when a round needs them, and rotation already ensures a repeat
search asks something new.

### B. Obituaries and local press — untested, plausibly strong
A founder's death or retirement notice is a hard, dated succession event, and
local papers report exactly this for trade businesses. It fits the existing
web-search channel — no new vendor — but it is untested and the phrasing needs
work to avoid returning funeral homes.

### C. Job postings — untested, indirect
A family firm hiring a General Manager or COO is often a founder stepping back.
Indirect, noisier than the above, and would need a source.

### D. Registry officers — tested, blocked in NY
See section 3. Viable in states that publish officers; not in his main ones.

---

## 5. Subscriptions — nothing to approve

No paid subscription is recommended. The candidates were:

| service | verdict |
|---|---|
| Family-business database | does not exist |
| OpenCorporates / Moody's ownership | wrong data — corporate hierarchy, not family succession |
| Bulk state registry data | [$50k–$200k/year](https://govfiles.dev/) for 50-state coverage; absurd at this scale |
| Registry lookup per company | $0.004, tested, no officers in NY |

The two highest-value changes — reweighting spend away from Maps, and adding
query phrasings — cost **nothing** and use vendors already integrated.

---

## 5b. What happened when it was actually done (2026-08-09)

The classifier gate was run first, as section 6 requires: `eval-labeled.mts`
MODE A against the 72.

  QUALIFIED recall        12/13 fetched  (92%, above the 90% bar)
  no_founder_and_nextgen  21/25 fetched agreed
  name traps              3/3 handled — Two Generations Landscaping,
                          3 Generations Improvements and Dad and Daughter
                          Custom Homes were all correctly NOT signalled

The classifier is not the bottleneck, so the discovery change was safe to make.

The three disagreements are worth reading before anyone calls them errors. In
each, the classifier found a REAL named pair the auditor had cut:
Levitch (Maurice -> Brian), Boniello (Gus Sr -> Gus Jr and three brothers),
Family Development (Kevin -> Amanda Brongo). The auditor was reading the
leadership PAGE; the classifier reads the whole About text. That is a
difference about where evidence must appear, not evidence of keyword matching.

Size gates scored badly on purpose-relevant grounds: `too_small` agreed on
0 of 7 and `too_big` on 3 of 6. That is independent confirmation that revenue
estimates are unreliable, and it is why the band gate was loosened to require
a real parsed range before it cuts anything.

### The cost claim did NOT hold, and the comparison is confounded

A verification run after the cut showed the buy dropping 30 -> 12 places
exactly as designed. It did not show a cheaper run:

  before   $0.261   30 map places   4 leads
  after    $0.297   12 map places   5 leads

Maps fell by $0.072 and classify plus Firecrawl rose by $0.088, because the
run read three more companies. Cost per lead improved 9% ($0.065 -> $0.060).

That comparison proves very little, and it should not be quoted as if it did.
Between the two runs the database was reset AND 67 hand-audited companies were
seeded into cross-search memory, which changes which candidates get skipped
before anything is read. The two runs had different starting conditions.

What IS established: the buy is capped at 12 and tied to what the round can
read. What is NOT established: that the cut lowers total cost per run. The
honest case for it remains the buy/read mismatch — paying for places the
ordering layer was never going to read — not a demonstrated saving.

## 6. What to do, in order

1. **Add succession query sets.** Free, uses the best-measured channel, and the
   hand audit is the evidence that this is where signals live.
2. **Cut the Maps place budget.** 39% of spend at 1-in-69. Reducing it and
   letting web search take the round budget should raise the rate and lower the
   cost simultaneously.
3. **Re-measure after both.** The current per-channel numbers come from small
   samples — 2 signals for web search, 1 for maps. Directionally clear, but
   they need re-checking once volume is higher before anything is tuned harder.
4. **Leave the classifier alone.** It is not the bottleneck. Discovery is: the
   classifier only ever sees what discovery hands it, and a channel running at
   1-in-69 is feeding it 68 companies that were never going to qualify.

---

## 7. What was NOT changed, and why

Nothing in this document has been implemented. Reweighting channel spend changes
what every future search costs and returns, and that is the client's money and
the client's lead quality. It should be a deliberate decision, taken once,
rather than a side effect of a research pass.
