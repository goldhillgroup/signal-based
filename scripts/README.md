# Scripts

Maintenance and evaluation tools. **Every one that writes is dry-run by
default** and prints what it would do; add `--write` to apply. All of them are
idempotent — running one twice is safe, and re-running a converged one prints
"nothing to do" rather than doing something.

Run from the repo root: `npx tsx scripts/<name>.mts`

---

## Data repair

Each of these exists because a rule was added *after* rows had already been
written. The rule is enforced at write time now, so these only ever touch
history. The status column is what a dry run reported on **11 Aug 2026**.

| Script | Fixes | Status |
|---|---|---|
| `backfill-phone.mts` | Reads a phone number off the page footer for leads that have none. Coverage went 37% → 96%. | ~10 pages genuinely print no number |
| `backfill-confidence.mts` | Drops `high` to `verify` where there is no receipt or no stated relationship. | converged (0) |
| `backfill-callable.mts` | Demotes succession claims resting on a name nobody can look up ("Francisco Sr."). | converged (0) |
| `backfill-sheet.mts` | Strips hedged titles and revenue bands so every displayed value is a fact. | converged (0) |
| `backfill-quotes.mts` | Repairs evidence quotes stitched from fragments into one passage that is really on the page. | converged |
| `backfill-recheck.mts` | Gives rejections a reconsideration date. A NULL date means permanent. | 29 correctly permanent (brokerages, magazines, directories) |

`backfill-phone.mts` costs one Firecrawl credit per company and is paced to
stay under the ~45 requests/minute limit. The others are free.

---

## Housekeeping

**`reset-leads.mts`** — empties the dashboard without making the system stupid.
Removes the folders but sets `search_id = null` on the companies rather than
deleting them, so cross-search memory, the recheck schedule and the measured
channel yields all survive. Keeps the "Hand-audited proof list", which is
Jonathan's own vetted data rather than a test run.

**`recover-orphans.mts`** — the inverse. Puts companies with no folder back
into one, grouped by vertical and state. A company with `search_id = null` is
invisible: folders are how leads are listed, and enrichment is folder-scoped,
so an orphan cannot be viewed, exported or enriched.

> **These two undo each other.** `reset-leads` detaches on purpose;
> `recover-orphans` reattaches. Running recover after a reset puts the whole
> dashboard back. Normal use never creates an orphan — `companies.search_id` is
> `ON DELETE CASCADE`, so deleting a folder deletes its companies.

**`harvest.mts`** — runs the monthly harvest from the command line, the same
code path GitHub Actions uses. Dry-run by default.

---

## Evaluation

**`eval-labeled.mts`** — scores the classifier against `labeled72.json`, 72
hand-labelled companies with a known verdict. **Run this before changing the
classify prompt or the model.** Recall varies run to run — six consecutive runs
scored 12, 13, 11, 12, 11, 11 out of 13, a mean of 11.7 — so a single run is
not evidence that a change helped or hurt. Compare means over several runs.

**`seed-labeled.mts`** — loads that labelled set into the database.

**`e2e-run.mts`** — drives one full search end to end and grades the result.
Spends real money on real vendors.
