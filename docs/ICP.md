# The Goldhill Group — Ideal Client Profile

Jonathan's profile as he wrote it, and **where each part of it lives in the
code**. The second half is the point: this document exists because the system
was originally built to a narrower brief, every part of the pipeline agreed
with every other part, and all of them were agreeing about the wrong profile.
Nothing surfaced the gap until the written ICP was read against the code.

Last reconciled: **12 August 2026**.

---

## The one-sentence version

> A **next-generation leader** in a privately held, multigenerational family
> business who is **taking on greater leadership responsibility while the
> founder or senior generation is still involved**.

The word doing the work is **"still"**. A founder who has fully gone leaves no
transition to coach; a founder with no successor has nothing to hand over. Two
generations existing *in the company's history* is not the same as two people
*in charge right now* — and that distinction is where nearly every false
positive came from.

---

## Company criteria

| | Jonathan's ICP | In the code |
|---|---|---|
| Ownership | Family-owned and operated, preferably 2nd or 3rd generation | `stillFamilyOwned` gate, classifier |
| Revenue | **$5M–$30M**, sweet spot $5M–$15M | `DEFAULT_ICP` in `lib/pipeline/icp-types.ts`; editable in Settings |
| Employees | 25–150, with 3–10 in office/management roles | Read but **not gated** — see [Not enforced](#not-enforced) |
| History | Established, usually 15+ years | Read but **not gated** |
| Location | US, priority CA · NY **and the Northeast** · FL · TX | `AGREED_STATES` in `lib/pipeline/us-states.ts` |

The revenue band was **$3M–$15M** until this reconciliation. Seven companies
had already been cut as "too big" that sit inside the $30M ceiling — Stay Green
Inc. at an estimated $24–69M among them.

"New York and the Northeast" was searching **New York alone** — one state out
of nine. `AGREED_STATES` now carries NJ, PA, CT, MA, RI, NH, VT and ME as well.

---

## Priority industries

> Operationally complex, owner-led businesses … "These companies typically have
> employees, managers, equipment, projects, customers, and operating
> complexity. **They are not lifestyle businesses or solo professional
> practices.**"

Eight verticals, all live in `lib/supabase/types.ts` and in the database's
`companies_industry_check` constraint:

| Vertical | Covers |
|---|---|
| `landscaping` | Landscaping, design-build, lawn care, tree service, irrigation, hardscape, outdoor living |
| `home_builder` | Luxury and custom homebuilding, residential GCs, design-build remodelers |
| `construction` | Commercial GCs, concrete, excavation, sitework, paving, demolition, restoration |
| `trades` | Electrical, plumbing, HVAC/mechanical, roofing, specialty trades |
| `manufacturing` | Metal fabrication, machine shops, millwork, cabinetry, building products |
| `distribution` | Building-materials suppliers, industrial and equipment distributors, wholesale |
| `property_services` | Property/facility maintenance, janitorial, pest control, pool service |
| `professional_services` | Engineering, architecture, accounting, insurance — **only** with several family members involved |

**This was two verticals.** The classifier prompt listed *"HVAC, roofing-only,
plumbing, a materials supplier or distributor"* as `other` → "can never
qualify" — four of them named targets in this ICP. Worse, the database `CHECK`
constraint allowed exactly two values, so the rejection was at the storage
layer: an electrician with a father and daughter running it together **could
not be saved** however much the pipeline wanted it.

Measured before the change: **42 companies had been read, paid for and
discarded** for being a trade this profile asks for.

`professional_services` is deliberately the narrowest. The ICP admits "select"
firms and explicitly excludes "solo professional practices", so every discovery
query for it carries the family constraint rather than trusting the classifier
to apply it after the crawl is already paid for.

---

## Who to contact

**The next-generation family member, first.** Typical age 30–50. Titles, in
Jonathan's order of preference:

President · Business Owner · CEO · COO · General Manager · Vice President ·
Managing Director · Director of Operations · next-generation owner or successor

> "This person has already entered the business and is either running it,
> preparing to take over, or trying to earn the authority needed to lead it."

The founder or senior owner is a **secondary** target — worth contacting mainly
where succession planning is visibly underway.

In the product this is the `next_gen` column, and it is why enrichment refuses
to treat `info@` as a finished lookup: a shared inbox reaches whoever screens
it, not the successor by name.

---

## The nine situations he coaches

The strongest prospects show one or more of:

1. The founder says they want to step back but continues controlling decisions.
2. The next-generation leader has responsibility without full authority.
3. The successor is struggling to earn credibility with longtime employees.
4. The company is growing faster than its management systems.
5. The business needs professional management, accountability, KPIs, documented process.
6. Family roles, ownership roles and management roles are unclear.
7. Siblings disagree about leadership, compensation, ownership or direction.
8. The family is discussing succession, ownership transfer, a buyout or a sale.
9. The next generation wants to modernise without disrespecting the founder.

**Situation 1 was being actively rejected.** The classifier cut any founder who
had "fully stepped back" — which is the exact person in situation 1, and which
also contradicts the signal list below. Presence, not title, is now the test:
still named on the leadership page in any capacity means still there.

**Situation 7 was being rejected too.** Siblings were cut outright as
"one generation". They are still not a founder-and-successor *pair*, but they
are a family-owned company worth keeping, and sibling disagreement is
explicitly something he coaches.

---

## The twelve observable signals

> "Because family conflict and succession concerns are rarely stated publicly,
> the agency should look for indirect evidence."

Each maps to a string the classifier may return in `other_signals`:

| Signal | Stored as |
|---|---|
| Founder and one or more adult children in leadership | `founder_and_children_in_leadership` |
| Next-gen recently promoted to president, COO or GM | `next_gen_promoted` |
| "Second-generation" / "third-generation" language | `generation_language` |
| Anniversary stories spanning multiple generations | `anniversary_story` |
| Leadership-transition announcements | `leadership_transition` |
| Founder moving into chairman or advisory role | `founder_to_chairman` |
| Next-gen featured in interviews or company news | `next_gen_featured` |
| Rapid hiring, expansion, acquisitions, new facilities | `growth` |
| Multiple siblings or relatives in executive positions | `multiple_relatives_executive` |
| Ownership-transfer or change-of-ownership indicators | `ownership_transfer` |
| EOS, Scaling Up, professional management, advisory board | `professional_management` |
| Legacy language — preserving it while preparing for the future | `legacy_language` |

### The scoring rule, which is the important part

> "**No single signal proves that the company needs help.** Leads should be
> assigned a confidence score based on the **number and quality** of the
> signals found."

Confidence previously rested on **one** test — are two named people from two
generations both currently present. That scored a company showing a chairman
move, an announced transition and three siblings in executive roles exactly the
same as one that merely says "second generation".

Now:

- **high** — both generations named with current titles, explicit succession
  language, **and at least two supporting signals**. This label means "act
  without checking", so it has to be earned.
- **medium** — the pairing is there but succession language is implied, or
  fewer than two supporting signals.
- **verify** — a real but thinner hint; both generations still named and
  present, relationship or handoff implied rather than stated.

A separate gate lowers any `high` that has no receipt or no stated
relationship — see `earnedConfidence` in `lib/lead-signal.ts`. Two leads were
carrying `high` on a shared surname alone.

### Where these signals actually live

More than half of them get **announced** rather than described: transitions,
promotions, anniversary pieces, next-gen interviews, acquisitions. Those appear
in local business journals and trade press, **not on a company's own About
page** — which is why the six new verticals' discovery queries mix one
self-description query per set with two announcement-shaped ones.

---

## Not enforced

Honest list of things in the ICP that the pipeline reads but does **not** gate
on, so nobody assumes coverage that isn't there:

- **Employee count (25–150)** and **office/management headcount (3–10).** Rarely
  stated on a website in a form worth trusting. Feeds the size estimate only.
- **15+ years of operating history.** Often inferable from "since 1978", but a
  hard gate here would cut a genuine 12-year-old family firm on a missing
  sentence.
- **Contact age 30–50.** Not knowable from a company page, and guessing it from
  a photograph is not something this should do.
- **Sweet spot $5M–$15M.** The classifier is told the sweet spot so it can
  prefer the middle, but the band accepts the full $5M–$30M.

These are all cases where missing information would otherwise be read as
failure. The rule throughout the pipeline is that absent evidence produces
`unknown`, never a rejection.

---

## What still limits results

Not an ICP question, but the thing most likely to be mistaken for one.

A confirmed founder-and-successor pair turns up in roughly **one company in
twenty** on the best discovery channel (web search: 4.8 per 100 read; Google
Maps: 0.9). Jonathan's own hand-auditing runs at 41.8 per 100 — a person
reading carefully is about eight times more efficient at *finding* than the
crawler is. **Classification is not the bottleneck; discovery is.**

So a target of 10 means roughly 200 companies read, three or four automatic
passes, and about $4. The count is small because the signal is genuinely rare.
