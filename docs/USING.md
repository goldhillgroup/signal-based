# Using Signal Radar

**https://signal-based.vercel.app**

What it does: finds landscaping and home-building companies where **the founder
is still running things while a son or daughter steps up beside them** — and
shows you the sentence on their own website that proves it.

That last part is the product. Anyone can hand you a list of names. This hands
you a name, a quote, and a link, so you can check it in about ten seconds.

---

## The five-minute version

1. **Dashboard** → pick a vertical and states → **Search**.
2. Wait. A pass takes 1–3 minutes and it will start further passes by itself.
3. Open the folder. Leads are sorted best-first.
4. Read the quote on each lead. **Trust the quote, not the badge.**
5. Tick the leads you want → **Find emails**.
6. **Copy for Google Sheets** → paste into a sheet.

---

## Settings: do this once

**Settings → Your ideal client.** One sentence describing the *moment* you are
looking for. It ships as:

> founder still leading with a son or daughter stepping up beside them

This is the most powerful control in the product. It doesn't just filter results
at the end — it becomes the actual questions the search asks Google. Change this
sentence and you change which companies get found.

Describe the **moment**, not the industry. The vertical and states are separate
controls; putting "landscaping company" here wastes the queries on something
already covered.

Also set your **revenue band** here ($3–15M by default). Every new search starts
from both.

---

## Running a search

**Vertical and states are hard filters.** A landscaping search in Texas returns
Texas landscapers, full stop.

**Signal focus** is optional. Leave it blank and it uses your ideal client. Fill
it in to go after something specific for this one search.

**Mode:**

| Mode | Use it when |
|---|---|
| **Hybrid** *(default)* | Normal use. Keeps confirmed pairs *and* good family-owned companies. |
| **Signal only** | You only want confirmed founder-and-successor pairs. Fewer results, all strong. |
| **Filter only** | You want the category and size, and will judge succession yourself. |

**Target** is a number of *signals*, not companies. Ask for 20 and it keeps
going in passes until it finds 20 or genuinely runs out.

---

## "If I search the same thing twice, do I get the same list?"

**No.** Every company it has judged is remembered, and a repeat search **skips
re-reading them** — so running the same search again goes *further* into the
same ground instead of re-buying answers it already has.

Measured: an identical re-run read 4 companies instead of 11 and still returned
3 new leads.

Your previous leads are not deleted or hidden. They stay in their own folder and
in All Leads. Nothing overwrites anything.

There is a switch on the form — **"Re-check companies I've already seen"** — off
by default. Turn it on only when you want a previous pass re-done; it costs a
full read for every company it revisits.

Rejected companies come back on their own schedule anyway. A company cut for
*"only one generation on the page"* returns in 90 days, because that is exactly
the fact that changes when a son or daughter steps in.

---

## Reading a lead

Three badges:

- **High** — a receipt *and* a stated relationship. Act on it.
- **Medium** — the pair is there, the succession language is implied.
- **Verify** — real and worth a look, but **check it yourself first.**

**The badge is a summary. The quote is the evidence.** Every lead showing a
quote that names both people has been checked against the live page. If a lead
has no quote, that is the one to look at before calling.

One caveat: your own imported companies show as **High** with no quote. That is
correct — the receipt is that you vetted them yourself.

### What a strong lead looks like

> **Truesdale Nursery** — *"owned and operated by James Dinizo, son of founder
> Ralph Dinizo. **Ralph remains an integral part of our team**"*

The handover has happened and the founder is still there. That is the exact
moment your offer is relevant.

### The thing to watch for

The two named people usually share a surname — that is what a family business
looks like, which is also why the surname alone proves nothing. If the quote
doesn't actually *say* they're related, treat it as unconfirmed regardless of
what the badge says.

---

## Rejected companies

Everything cut is kept, with the reason, on the **Not a fit** tab. You can read
why, and you can enrich them anyway if you disagree. Nothing is thrown away
silently.

---

## Finding emails

A separate step, on purpose — searching is cheap, email lookup is not.

Tick the leads you want → **Find emails**. Each address is checked for
deliverability before it reaches you, and you are only billed for addresses
actually found. Roughly $0.05 each.

---

## Exporting

**Copy for Google Sheets** copies every lead as tab-separated rows. Open a
sheet, click a cell, paste. Columns land correctly with no import step.

Everything in the sheet is confirmed — no hedged titles, no "unknown" revenue
bands, no quotes stitched from fragments.

---

## Why searches run in passes

The server stops any single run at five minutes. Rather than fail, a run stops
cleanly 45 seconds early, **saves everything it found**, and starts the next
pass by itself. A big target simply takes several passes off one press of
Search.

You will see the pass counter move. Nothing is lost between passes, and nothing
is paid for twice.

This is why the app does **not** need a paid Vercel plan.

---

## What it costs

- About **2 cents per company read** — a typical search is $0.20–$0.60.
- About **5 cents per email found**.
- **$29/month Apify** is the only fixed cost.

Settings shows every vendor's balance live. If a search suddenly returns
nothing, check there first — a vendor running out of credit looks like "found
nothing", not like an error.

---

## What to expect, honestly

A typical run returns **3–6 leads with 0–2 confirmed pairs.** The best channel
finds roughly 5 confirmed pairs per 100 companies read.

Hand-auditing finds them faster than this does — you run about 42 per 100. What
this buys is that it does it continuously, at 2 cents a company, while you do
something else.

**Don't expect 20 signals from one 90-second run.** Set a target, let it run its
passes, and come back.

---

## If something looks wrong

| Symptom | Look here |
|---|---|
| Search returns nothing at all | Settings → vendor balances. Something is out of credit. |
| A lead looks wrong | Open the source link. If the page doesn't say it, tell Daniel — that is a real bug. |
| Search seems stuck | It is running passes. The counter moves; give it a few minutes. |
| Can't log in | "Forgot password?" on the login page. |
