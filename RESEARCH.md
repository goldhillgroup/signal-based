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

**The manual method is 12× better than the best automated channel and 34×
better than the most expensive one.**

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

Maps is **39% of a run's cost** ($0.12 of $0.31) and returns the worst leads.
Web search is 10% of cost at nearly 3× the rate. The cheapest large improvement
available is to move spend from one to the other — no new vendor, no new
integration, no subscription.

There are currently **4 query sets, ~12 phrasings** for landscaping. The hand
audit found 28 signals by searching this way. More phrasings is the single
highest-return change in the system and it costs nothing but the queries.

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
