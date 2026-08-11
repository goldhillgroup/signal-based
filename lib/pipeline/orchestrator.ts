import { createServiceRoleClient } from "../supabase/server";
import { discoverCandidates, fetchCompanyPages, pickBestPage, fetchSingleUrl, isOffTradeName, type Candidate, type FetchedPage } from "./apify";
import { classifySignal, disprovePass } from "./openrouter";
import { findContact } from "./anymailfinder";
import { verifyEmail } from "./millionverifier";
import type { Industry, SearchMode, SearchRow } from "../supabase/types";
import { recheckAfterFor, rejectionScope, sizeVerdictStillBinds, parseRevenueBand } from "./recheck-policy";
import { extractEmails, bestEmailFor, type FoundEmail, bestPhoneFor, isSharedInbox } from "./page-email";
import { callableName, cleanPersonName, cleanRevenueBand, cleanTitle, earnedConfidence } from "../lead-signal";
import { buildWarningLine } from "./channel-health";
import { channelRates, orderByYield } from "./channel-priors";
import { runWithCounters, estimateUsd, describeCost, type CostCounters } from "./cost-tracker";

// Contact enrichment (Anymailfinder + MillionVerifier) lives in
// enrichContacts() at the bottom of this file, NOT inline in the discovery
// loop below. Two-step flow (2026-08-06, for testing): discovery +
// classification runs and shows results on its own; enrichment is a
// separate, manually-triggered pass over whatever that run accepted — see
// app/api/search/[id]/enrich/route.ts. It was briefly wired inline for one
// commit; pulled back out per direct instruction to keep the two steps
// testable independently rather than paying for enrichment on every search.

// The target is a SIGNAL count, not a raw candidate count: "give me 100
// signals" means keep discovering + classifying in rounds, accumulating
// qualified+verify companies, until ~100 are found — not "scan 100 companies
// and stop." Confirmed signals from an early round are never discarded; a
// short round just triggers another round rather than being treated as done.
const ROUND_SIZE = 15;

// Ceiling on how many due-for-recheck companies one run pulls in. Without it a
// first sweep after a long gap would front-load hundreds of free reads and
// crowd out new discovery entirely — the run would spend its whole scan
// ceiling re-reading known companies and find nothing new. Bounded so a run is
// always part re-check, part fresh ground.
const RECHECK_PER_RUN = 20;
import { scansFor } from "./scan-limits";
import { RUN_CEILING_MS } from "./reap";

// How many companies are classified at once. Each one is 1-2 OpenRouter calls
// (classify, plus disprove when there's a signal to check), so this is bounded
// by politeness to that API rather than by anything local. 5 turns a measured
// ~14.6s-per-company serial pass into roughly 3s per company.
const CLASSIFY_CONCURRENCY = 5;

// Plain worker pool — same shape as the one in apify.ts, kept local so the two
// call sites can be tuned independently (page fetching and LLM classification
// have very different rate-limit profiles).
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
  /**
   * Checked before EACH item, so a run that is out of time stops mid-round
   * instead of finishing all fifteen. A round is ~15 companies at ~5s each,
   * so a round-boundary-only check could overshoot by more than a minute —
   * which is precisely the margin that decides whether the platform kills us.
   */
  shouldStop?: () => boolean
) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      if (shouldStop?.()) return;
      const item = items[cursor++];
      await run(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

type Supa = ReturnType<typeof createServiceRoleClient>;

async function bump(supabase: Supa, searchId: string, patch: Partial<SearchRow>) {
  const { error } = await supabase.from("searches").update(patch).eq("id", searchId);
  if (!error) return;

  // This function's errors were previously swallowed entirely, which is fine
  // for a mid-run progress tick but dangerous for the FINAL write: if the
  // patch mentions a column the deployed database doesn't have yet (a
  // migration not yet applied), the whole update is rejected and the search
  // sits at status 'running' forever, with the work done and invisible.
  // Strip whichever column PostgREST names as missing and retry, so an
  // unapplied migration degrades to "that one field isn't saved" instead of
  // "run never finishes". Bounded by the number of keys in the patch.
  const current: Partial<SearchRow> = { ...patch };
  let err = error;
  for (let i = 0; i < Object.keys(patch).length; i++) {
    const m = /'([a-z_]+)' column/.exec(err.message ?? "");
    if (!m || !(m[1] in current)) break;
    console.warn(
      `Search ${searchId}: '${m[1]}' column missing in DB, apply the latest supabase/migrations. Saving without it.`
    );
    delete (current as Record<string, unknown>)[m[1]];
    const retry = await supabase.from("searches").update(current).eq("id", searchId);
    if (!retry.error) return;
    err = retry.error;
  }
  console.warn(`Search ${searchId}: update failed, ${err.message}`);
}

// Last-resort name when neither og:site_name nor the classifier could read
// one off the page (e.g. the fetch failed entirely) — never used when a real
// source name is available.
function cleanDomainName(domain: string): string {
  const label = domain.split(".")[0].replace(/[-_]+/g, " ").trim();
  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

// og:site_name is usually the best source (see resolveName below) but a real
// live run surfaced a company saved as literally "Mysite" — a never-
// customized WordPress/theme default that happened to be set as the site
// name. Distrust the handful of common placeholder values rather than
// blindly trusting whatever og:site_name says.
const PLACEHOLDER_SITE_NAMES = new Set([
  "mysite",
  "my site",
  "home",
  "untitled",
  "welcome",
  "wordpress",
  "new site",
  "site title",
]);

function resolveName(
  siteName: string | null,
  classifiedName: string | null,
  domain: string
): string {
  if (siteName && !PLACEHOLDER_SITE_NAMES.has(siteName.trim().toLowerCase())) {
    return siteName;
  }
  return classifiedName ?? cleanDomainName(domain);
}

// Matches classifySignal's MAX_PAGE_CHARS — compose to the same ceiling so
// the slice there never cuts a section mid-way.
const CLASSIFY_TEXT_BUDGET = 12000;

/**
 * The text classify actually reads: the best page, plus the best DISTINCT
 * other page while budget remains. Evidence for one company is routinely
 * split across pages — founder story on /about, the next generation on
 * /team — and feeding only one page made the other half structurally
 * invisible no matter how good the rubric is (Russell Landscape Group was a
 * real miss of exactly this shape). Same total budget as before; secondary
 * sections are labeled with their URL so a quote can still be traced.
 */
function buildClassifyText(primary: FetchedPage, all: FetchedPage[]): string {
  let text = primary.text.slice(0, CLASSIFY_TEXT_BUDGET);
  const remaining = CLASSIFY_TEXT_BUDGET - text.length;

  if (remaining > 800) {
    const secondary = all
      .filter((p) => p.url !== primary.url && p.text.length >= 300)
      // Most additional text first — and skip near-duplicates of the primary
      // (same page under two URLs after a redirect).
      .filter((p) => !p.text.startsWith(text.slice(0, 200)))
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (secondary) {
      const header = `\n\n=== ANOTHER PAGE FROM THE SAME SITE (${secondary.url}) ===\n\n`;
      text += header + secondary.text.slice(0, Math.max(0, remaining - header.length));
    }
  }
  return text;
}

/**
 * Does the model's evidence quote actually appear in the text it was shown?
 * Normalizes the punctuation classes that legitimately differ between page
 * HTML and model output (curly vs straight quotes, dash variants, whitespace
 * runs) and then requires a literal substring hit. Long quotes only need
 * their first ~80 normalized chars to match, so a quote the model trimmed
 * with an ellipsis still verifies while an invented one still fails.
 */
export function quoteAppears(quote: string, pageText: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–-]/g, "-")
      .replace(/…/g, "...")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const q = norm(quote);
  if (q.length < 12) return true; // too short to meaningfully verify
  const hay = norm(pageText);
  return hay.includes(q.length > 80 ? q.slice(0, 80).trim() : q);
}

/**
 * Reduce a STITCHED quote to its longest continuous run that is really on the
 * page — or return null if none of it is.
 *
 * Measured across 44 signal leads: 63% of quotes were stitched. The model joins
 * separated snippets with "..." or quotes two phrases side by side, producing
 * receipts like
 *
 *   "2nd generation." "took over."
 *   "father daughter duo." "family company."
 *
 * Every fragment is real, so the finding is sound — but the QUOTE is not
 * something Jonathan can check. He opens the page, searches for what the card
 * told him, and does not find it. On a product whose entire promise is "here is
 * the sentence that proves it", a receipt that cannot be found is worse than a
 * shorter one that can.
 *
 * THIS DOES THE WHOLE JOB, and deliberately so. The obvious fix was to forbid
 * stitching in the classifier prompt. That was tried and dropped in favour of
 * this — not because it hurt recall (it was suspected of costing a lead, and
 * six runs against the 72-company set say otherwise: 12, 13, 11, 12, 11, 11,
 * mean 11.7/13, which is the noise floor of the eval rather than a signal) but
 * because a deterministic post-process is simply better than an instruction the
 * model may or may not follow on any given page. The prompt now merely PREFERS
 * a continuous passage.
 *
 * Worth knowing when reading that eval: its mean sits ON the 90% acceptance
 * bar, and single runs swing +/- one lead. No single run of it should be taken
 * as evidence that a change helped or hurt.
 *
 * So the repair is post-processing: split on the joins the model actually uses,
 * keep the longest piece that verifies against the page, and drop the quote
 * entirely rather than show one that cannot be found. Never invents or edits
 * words. Deterministic, free, and it cannot affect what gets qualified.
 */
/**
 * Strip what the model wrapped around the quote, and nothing else.
 *
 * Models return an excerpt already inside quotation marks about a sixth of the
 * time. The card renders it inside a blockquote with its own quote styling, so
 * it shows as ""Bill instilled his values…"" — and more importantly the stored
 * text no longer matches the page, because the page does not contain those
 * marks. A receipt that fails its own verification for punctuation is a bad
 * receipt.
 *
 * Only balanced wrapping marks are removed. A quote that legitimately contains
 * a quotation inside it is untouched.
 */
export function tidyQuote(q: string | null | undefined): string | null {
  if (!q) return null;
  let t = String(q).replace(/\s+/g, " ").trim();
  while (t.length > 2 && /^["“”']/.test(t) && /["“”']$/.test(t)) {
    t = t.slice(1, -1).trim();
  }
  return t || null;
}

export function longestVerifiableQuote(
  quote: string,
  pageText: string,
  /** Names to prefer — the founder and the successor, if known. */
  prefer: (string | null | undefined)[] = []
): string | null {
  const pieces = quote
    .split(/\s*(?:\.\.\.|…)\s*/)
    .flatMap((p) => p.split(/"\s*"/))
    .map((p) => p.replace(/^["“”\s]+|["“”\s]+$/g, "").trim())
    .filter((p) => p.split(/\s+/).length >= 4);

  const verified = pieces.filter((p) => quoteAppears(p, pageText));
  if (verified.length === 0) return null;

  // RELEVANCE FIRST, LENGTH ONLY AS A TIE-BREAK.
  //
  // Picking the longest surviving fragment is the obvious rule and it is wrong.
  // On RR Landscape it discarded "Colt Ritzel joined his father, Ross, in 2021"
  // — the sentence that IS the finding — in favour of a longer one about
  // commitment to innovation. A receipt that proves nothing is no better than a
  // receipt that cannot be found.
  //
  // So score for what the quote is supposed to evidence: the two people by
  // name, and the language of a handover. Length breaks ties only.
  const firstNames = prefer
    .filter((n): n is string => !!n)
    .map((n) => n.trim().split(/[\s,]+/)[0].toLowerCase())
    .filter((n) => n.length > 2);

  const SUCCESSION =
    /\b(son|daughter|sons|daughters|joined|took over|taking over|second|third|fourth|next generation|generation|father|mother|family business|succeed)\b/i;

  const score = (p: string) => {
    const low = p.toLowerCase();
    let n = 0;
    for (const f of firstNames) if (low.includes(f)) n += 3;
    if (SUCCESSION.test(p)) n += 2;
    return n;
  };

  return verified.sort((a, b) => score(b) - score(a) || b.length - a.length)[0] ?? null;
}

/**
 * Does a previously-settled company still bind THIS search?
 *
 * True  -> skip it, we already have our answer and it is still the right answer.
 * False -> let it through; the verdict on file was made against criteria this
 *          search does not share, so it never judged this question.
 *
 * Accepted companies always bind: the lead is already on his list, and paying
 * to re-classify it would buy a duplicate. Only rejections are re-opened, and
 * only along the axis the rejection was actually about.
 */
export function bindsThisSearch(
  row: {
    status?: string | null;
    rejection_reason?: string | null;
    industry?: string | null;
    revenue_band?: string | null;
  },
  searchIndustry: Industry,
  band: { min: number | null; max: number | null } | undefined
): boolean {
  if (row.status !== "rejected") return true;

  switch (rejectionScope(row.rejection_reason ?? null)) {
    case "industry":
      // "Not a landscaper" is a fact about a landscaping search. Another
      // vertical is entitled to its own look.
      return row.industry === searchIndustry;
    case "size":
      // Only binds while this search's band would reach the same verdict.
      return sizeVerdictStillBinds(row.revenue_band ?? null, band);
    default:
      return true;
  }
}

/**
 * Keep a city only if it is one. The model is asked for a bare town name, but a
 * page that says "serving the tri-state area" invites a phrase rather than a
 * place, and a blank cell is more honest on a call list than a wrong one.
 */
function cleanCity(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim().replace(/[.,;]+$/, "");
  if (t.length < 2 || t.length > 40) return null;
  if (/\d/.test(t)) return null; // a street address, not a city
  if (/^(n\/?a|none|unknown|not stated|various|nationwide|usa|united states)$/i.test(t)) return null;
  return t;
}

/**
 * Plain English, because this lands in front of the client.
 *
 * Deliberately NOT the reaper's "hit the server limit" wording: this run did
 * not hit anything, it stopped itself with time to spare and wrote a complete,
 * honest record. The action is identical either way — run it again, and
 * cross-search memory means the second pass picks up new companies rather than
 * re-reading the ones already settled.
 */
function timeUpMessage(scanned: number, kept: number): string {
  return (
    `Stopped at the time limit after checking ${scanned} companies. ` +
    `The ${kept} found are saved and complete. Run the same search again to ` +
    `carry on — it will pick up where this one left off, not start over.`
  );
}

export async function runSearchPipeline(
  searchId: string,
  industry: Industry,
  states: string[],
  targetSignals: number,
  mode: SearchMode = "signal",
  // Optional free-text focus, defaulting to the saved ideal client. It reaches
  // BOTH ends of the pipeline: classification treats it as a non-overriding
  // hint (classifySignal), and discovery turns it into quoted queries anchored
  // to the trade (refinementQueries). The old worry — free text dragging a
  // search off the agreed vertical — is handled by the vertical and states
  // remaining hard filters, so the focus decides what is ASKED within them.
  refinement?: string | null,
  // Step 01's revenue band, per-search. Both null = no limit. Applied as a
  // SOFT gate: a company only gets cut when the classifier's own size read
  // actively contradicts the chosen band — never on "unknown", since that
  // estimate comes from soft textual proxies (crew size, years in business),
  // not real financials, and cutting on a guess discards real companies.
  band?: { min: number | null; max: number | null },
  /**
   * Re-read companies this system has ALREADY judged, instead of skipping them.
   *
   * Off by default, which is what makes a repeat search useful rather than
   * wasteful: cross-search memory means running the same thing twice goes
   * FURTHER into the same ground instead of re-buying the answers it already
   * has. Measured — a repeat of an identical search read 4 companies instead of
   * 11 and still returned 3 new leads.
   *
   * Turning it on is the "I don't trust the last pass, look again" switch. It
   * costs a full read for every company it revisits, which is why it is a
   * deliberate choice and not the default. Rejections already come back on
   * their own schedule (recheck-policy.ts) without needing this.
   */
  includeAlreadyChecked = false
) {
  const supabase = createServiceRoleClient();

  // Meter every vendor call this run makes (see cost-tracker.ts) — the totals
  // land on the search row so each run's spend is a visible number, not a
  // dashboard archaeology project.
  const costCounters: CostCounters = { counts: {} };
  await runWithCounters(costCounters, async () => {
  try {
    // A run looking for succession pairs has to read about twenty companies
    // per pair; a run looking for ICP fits finds one in six. Using the fit
    // multiplier for both capped a "find 8 signals" search at 48 companies —
    // inside which roughly 2 pairs exist — so the request was arithmetically
    // impossible and the run stopped believing it was finished. See scansFor.
    const seekingSignals = mode !== "filter";
    const scanCeiling = scansFor(targetSignals, seekingSignals);

    // ── THE RUN'S OWN DEADLINE ───────────────────────────────────────────
    //
    // The loop used to have two exits — target reached, or scan ceiling hit —
    // and no idea what time it was. Past the platform's maxDuration the process
    // is simply terminated mid-loop, which is a different and much worse
    // ending: every completion path lives AFTER the loop, so nothing marks the
    // row. It stays status='running' forever, the progress dialog polls a dead
    // record, and Enrich refuses to touch the folder because it is not
    // 'complete'. reapStaleRuns exists to clean that up, but a reaper is a
    // mortuary, not a seatbelt.
    //
    // So: stop ourselves first. Finishing cleanly at 4 minutes with 30 leads is
    // strictly better than being killed at 5 with the same 30 leads and a
    // stranded row, because the clean ending writes the counts, the cost, the
    // warning and a finished_at that every downstream view already understands.
    //
    // The margin covers the tail: an in-flight classify can take ~15s, and the
    // final writes (counts, cost, evidence) need a few seconds more. Leaving 45
    // is deliberately generous — the cost of stopping slightly early is a
    // company or two, and the cost of being wrong is the stranded row above.
    const DEADLINE_MARGIN_MS = 45_000;
    const deadlineAt = Date.now() + Math.max(30_000, RUN_CEILING_MS - DEADLINE_MARGIN_MS);
    const outOfTime = () => Date.now() >= deadlineAt;

    // CROSS-SEARCH MEMORY — the thing that makes next month's scan different
    // from today's. Previously this started empty every run, so re-running a
    // state re-discovered and re-paid for the identical companies and handed
    // back the identical list.
    //
    // Now it is pre-loaded with every domain we've already settled: qualified
    // leads (already on his list) and rejections that aren't due for another
    // look yet. Rejections DO come back, on a schedule set by why they were
    // cut — see recheck-policy.ts. A company cut for "only one generation on
    // the page" returns in 90 days precisely because that is the fact that
    // changes when a son or daughter steps in.
    //
    // A rejection only suppresses the searches it was ENTITLED to judge. It
    // used to suppress all of them: any settled domain was skipped everywhere,
    // regardless of what the new search was actually looking for. So a firm cut
    // from a landscaping run for being an HVAC company was blacklisted from the
    // HVAC run it would have topped, for 18 months. Same for revenue: "too
    // small" was measured against one search's band and then applied to every
    // band. On live data that was 38 of 77 rejections (49%) suppressing
    // searches that never made the judgement — see rejectionScope().
    const seenDomains = new Set<string>();
    let skippedRecent = 0;
    let reopened = 0;
    {
      const nowIso = new Date().toISOString();
      // Paginate: this table grows without bound and a single select would
      // silently cap at PostgREST's default row limit, quietly re-scanning
      // everything past it.
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("companies")
          .select("domain, recheck_after, status, rejection_reason, industry, revenue_band")
          .or(`recheck_after.is.null,recheck_after.gt.${nowIso}`)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data) {
          if (!r.domain) continue;
          if (bindsThisSearch(r, industry, band)) seenDomains.add(r.domain);
          else reopened++;
        }
        if (data.length < PAGE) break;
      }
      if (includeAlreadyChecked) {
        // Everything stays in play. Cleared AFTER the scan rather than skipping
        // it so `reopened` is still counted honestly for the log line.
        skippedRecent = seenDomains.size;
        seenDomains.clear();
        console.log(
          `Search ${searchId}: re-checking everything — ${skippedRecent} previously-settled companies deliberately NOT skipped.`
        );
      } else {
        skippedRecent = seenDomains.size;
      }
      if (!includeAlreadyChecked) console.log(
        `Search ${searchId}: cross-search memory holds ${skippedRecent} settled domains, these are skipped, everything due for re-check is fair game.` +
          (reopened > 0
            ? ` ${reopened} more were judged by a search with different criteria and are back in play here.`
            : "")
      );
    }

    // ── SEEDED FROM WHAT THIS FOLDER ALREADY HOLDS ──────────────────────
    //
    // These used to start at zero and the final write OVERWRITES the row's
    // counts, which is correct for a first pass and destroys a second one: a
    // continuation would report only its own numbers, so a folder with 43
    // companies that gained 20 more would suddenly read 20.
    //
    // Seeding makes a run RESUMABLE. Target 100 needs ~20 minutes of scanning
    // and no serverless invocation on any plan will do that in one go, so the
    // only way to reach it is several passes accumulating into one folder.
    // Everything else already supported that — the companies attach by
    // search_id, cross-search memory skips what is settled, and the scan
    // ceiling is measured against totalScanned — this was the one place that
    // did not.
    //
    // Counting rows rather than trusting the stored counters on purpose: the
    // rows are the truth, and a counter that drifted for any other reason gets
    // quietly corrected by every continuation.
    let totalScanned = 0;
    let qualified = 0; // signal found, confidence high/medium (or fit-only accepted in filter/hybrid, no signal)
    let verify = 0; // signal found, confidence verify
    let fitOnly = 0; // filter/hybrid only: accepted on ICP fit, no signal found
    let accepted = 0; // qualified + verify + fitOnly, the denominator filter/hybrid targets against
    let rejected = 0;
    {
      // SEEDED FROM THE ROW THIS PIPELINE ITSELF WROTE, not by re-counting
      // companies. The two are not the same number and the difference is not a
      // bug in either: `companies_scanned` counts candidates PROCESSED, while
      // the companies table holds the ones that produced a row. Measured on a
      // real folder: 38 scanned, 32 rows.
      //
      // Counting rows therefore made a continuation's progress bar go
      // BACKWARDS — read 35 then 34, kept 20 then 15 — which is indistinguish-
      // able from the search losing work it had already done. Reading back the
      // counters keeps every number continuous and keeps the scan ceiling
      // measured in the same units the ceiling was written in.
      const { data: prior } = await supabase
        .from("searches")
        .select("companies_scanned, qualified_count, verify_count, fit_only_count, rejected_count")
        .eq("id", searchId)
        .single();
      if (prior) {
        totalScanned = prior.companies_scanned ?? 0;
        qualified = prior.qualified_count ?? 0;
        verify = prior.verify_count ?? 0;
        fitOnly = prior.fit_only_count ?? 0;
        rejected = prior.rejected_count ?? 0;
        accepted = qualified + verify + fitOnly;
      }
      if (totalScanned > 0) {
        console.log(
          `Search ${searchId}: continuing — ${totalScanned} already read, ${accepted} kept, ${rejected} cut.`
        );
      }
    }

    // What counts toward the target differs by mode:
    //  - 'signal': only companies with a real, confirmed succession signal
    //    (qualified + verify) count — a plain ICP-fit company doesn't move
    //    the needle. Unchanged from the original behavior.
    //  - 'filter' / 'hybrid': ICP fit alone is enough to accept a company, so
    //    the target means "how many companies," full stop — accepted counts
    //    every non-rejected company regardless of whether it happened to
    //    show a signal.
    //  - 'hybrid' counted `accepted` too, and that is what made a search feel
    //    empty. A run would fill its target with eight perfectly good fit-only
    //    companies, stop, and hand back zero founder-and-successor pairs —
    //    the one thing the product exists to find. Hybrid asks for pairs and
    //    keeps the fits it passes on the way, so pairs are what the target
    //    counts. 'filter' is unchanged: it never claimed to look for a signal.
    const countsTowardTarget = () =>
      mode === "filter" ? accepted : qualified + verify;
    let round = 0;
    let stoppedEarlyReason: string | null = null;
    // Accumulates across EVERY round, unlike roundChannelErrors which resets
    // each pass. A channel that was capped in round 1 and recovered by round 4
    // still means round 1 searched a smaller pool than it appeared to, so the
    // run as a whole was degraded and has to say so.
    const degradedChannels = new Set<string>();

    // CANDIDATE BUFFER — consume everything already paid for before paying
    // for more. Discovery channels return more than one round consumes (a
    // directory page yields 40 names, a Maps run 30 places), and the old code
    // cut the merged list at ROUND_SIZE and THREW THE REST AWAY — places and
    // extractions that were already billed. With Maps now rotating metros per
    // discovery call, those discards weren't even re-findable: round 2
    // searches a different city, so round 1's leftovers were simply lost.
    // Now: every fresh candidate lands here, rounds drain it ROUND_SIZE at a
    // time, and discovery is only re-invoked (and re-billed) when it's empty.
    const pending: Candidate[] = [];

    // ── Free reads first: companies whose re-check has come due ──────────
    //
    // recheck-policy.ts has always computed WHEN each rejected company is
    // worth another look — 14 days if the page simply would not load, 90 days
    // for "only one generation is named", which is exactly the fact that
    // changes when a daughter joins. That date was written on every row and
    // then never queried. A due company was only re-examined if a paid channel
    // happened to surface it again by luck.
    //
    // These cost NOTHING to find: the domain is already known, so the whole
    // discovery step is skipped and only the fetch+classify is paid for. They
    // go into the buffer BEFORE any discovery call, so the loop drains the
    // free reads first and only pays for new ground once they run out.
    //
    // This is also what makes the engine recurring rather than one-shot: the
    // universe it has already bought keeps producing new verdicts as the
    // companies in it change.
    let recheckSeeded = 0;
    try {
      const nowIso2 = new Date().toISOString();
      const { data: due } = await supabase
        .from("companies")
        .select("domain, source_url, state")
        .eq("industry", industry)
        .in("state", states)
        .lt("recheck_after", nowIso2)
        .not("recheck_after", "is", null)
        .limit(RECHECK_PER_RUN);
      const seenHere = new Set<string>();
      for (const r of due ?? []) {
        if (!r.domain || seenHere.has(r.domain)) continue;
        seenHere.add(r.domain);
        pending.push({
          domain: r.domain,
          url: r.source_url ?? `https://${r.domain}`,
          title: "",
          channel: "recheck",
          // Carry the state already on file. A re-checked company must not
          // silently change state just because it came back through a search
          // that happens to list a different one first.
          state: r.state ?? null,
        });
      }
      recheckSeeded = pending.length;
      if (recheckSeeded > 0) {
        console.log(
          `Search ${searchId}: ${recheckSeeded} companies came due for re-check, read first, at no discovery cost.`
        );
      }
    } catch {
      // Never let the sweep stop a search; discovery still runs as normal.
    }

    // ── Where in the rotation this run STARTS ────────────────────────────
    //
    // discoveryCalls drives which metro and which succession phrasing each
    // call uses (locationForRound / successionTermsFor). It used to start at
    // zero on every single search — so a search for Ohio run today and the
    // same search run in ten weeks both began at Cleveland with phrasing set
    // one, issued byte-identical queries, had every result filtered out as
    // already-seen, and concluded the pool was dry. The rotation existed but
    // reset before it could ever advance.
    //
    // Seeded instead from how much ground this (vertical, state) has already
    // covered: every ~ROUND_SIZE companies already on file moves the start one
    // step deeper. Deliberately derived from existing data rather than stored
    // in a new cursor table — a migration here has to be pasted into the
    // Supabase SQL editor by hand, and this needs no new state to be correct.
    // It is monotonic (the company count only grows), per (vertical, state),
    // and self-correcting: a search that finds nothing does not advance it,
    // so the next run re-asks rather than skipping ground it never covered.
    // Set once if the phone column is not there yet, so the run says so once
    // at the end instead of logging per company.
    let phoneColumnMissing = false;

    let rotationSeed = 0;
    try {
      const { count } = await supabase
        .from("companies")
        .select("*", { count: "exact", head: true })
        .eq("industry", industry)
        .in("state", states);
      rotationSeed = Math.floor((count ?? 0) / ROUND_SIZE);
    } catch {
      // Non-fatal: a failed count means we start at the top, which is exactly
      // the old behaviour. Never let bookkeeping stop a search.
    }

    // Per-channel signal rates: this installation's own history where it has
    // enough, the measured seeds otherwise. Read once per run, not per round.
    const rates = await channelRates();

    let discoveryCalls = rotationSeed; // drives metro/state rotation, NOT the same as classify rounds
    let poolDry = false;
    let totalDiscovered = 0;

    // How many discovery calls must come back empty IN A ROW before believing
    // a state is actually mined out.
    //
    // This used to be one. That was wrong, and expensively so: each discovery
    // call asks a DIFFERENT metro with a DIFFERENT succession phrasing (see
    // locationForRound and successionTermsFor), so a single empty result means
    // "Cleveland, asked that one way, returned nothing new" — not "Ohio has no
    // more landscapers". The run then stopped and stamped
    // candidates_pool_exhausted: true, which reads as a fact about the state.
    //
    // The real-world check that settles it: Ohio was recorded as exhausted
    // after 23 companies. Ohio has thousands of landscaping companies. The
    // flag was measuring the rotation, not the market.
    //
    // Four consecutive empties = four different metro+phrasing pairs all dry,
    // which is real evidence. The cost of being wrong in the old direction was
    // a truncated run reported as complete; in this direction it is at most
    // three extra discovery calls (~$0.03 of SERP pages, since the buffer
    // refills only when empty).
    const EMPTY_DISCOVERIES_BEFORE_DRY = 4;
    let consecutiveEmpty = 0;

    roundLoop: while (countsTowardTarget() < targetSignals && totalScanned < scanCeiling) {
      if (outOfTime()) {
        stoppedEarlyReason = timeUpMessage(totalScanned, countsTowardTarget());
        break roundLoop;
      }
      round++;
      const roundLimit = Math.min(ROUND_SIZE, scanCeiling - totalScanned);

      // ── 1. Refill the buffer only when it's actually empty ───────────────
      // Discover + fetch get their own try/catch: an Apify hiccup (timeout,
      // rate limit) on round 2+ must not discard signals already found and
      // persisted in earlier rounds — degrade to "stop here, keep what we
      // have" rather than letting it bubble to the outer catch's full
      // status: 'failed', which would misrepresent real, saved results as
      // a failed run.
      let roundChannelErrors: string[] = [];
      if (pending.length === 0 && !poolDry) {
        discoveryCalls++;
        try {
          const { candidates: fresh, channelErrors } = await discoverCandidates({
            industry,
            states,
            limit: roundLimit,
            round: discoveryCalls,
            excludeDomains: seenDomains,
            refinement,
          });
          if (channelErrors.length > 0) {
            roundChannelErrors = channelErrors;
            channelErrors.forEach((e) => degradedChannels.add(e));
            console.warn(`Search ${searchId} discovery ${discoveryCalls}: ${channelErrors.join(" | ")}`);
          }
          // Claimed for this search the moment they enter the buffer, so the
          // next discovery call can't re-return (or re-bill) them.
          fresh.forEach((c) => seenDomains.add(c.domain));

          // Drop the organisations whose own name says they are not a trade
          // business — associations, law firms, magazines, city departments.
          // Every channel produces them and each one previously cost a fetch
          // plus two model calls to be told what its title already said. The
          // rule is backtested lead-safe on the whole corpus (see
          // isOffTradeName); they are still counted as discovered, because
          // pretending discovery never returned them would misreport channel
          // yield.
          const offTrade = fresh.filter((c) => isOffTradeName(c.title) || isOffTradeName(c.domain));
          if (offTrade.length > 0) {
            console.log(
              `Search ${searchId}: skipped ${offTrade.length} non-trade organisation(s) before any spend — ` +
                offTrade.map((c) => c.title || c.domain).slice(0, 6).join(", ")
            );
          }
          pending.push(...fresh.filter((c) => !offTrade.includes(c)));
          // Best-yielding channels to the front, with an exploration slice so a
          // channel having a bad run still earns observations. Nothing is
          // dropped — the scan ceiling is simply spent on the most promising
          // candidates first, which is where the 7x difference between
          // web_search and maps actually turns into signals.
          pending.splice(0, pending.length, ...orderByYield(pending, rates));
          totalDiscovered += fresh.length;
          await bump(supabase, searchId, { candidates_found: totalDiscovered });

          if (fresh.length === 0) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= EMPTY_DISCOVERIES_BEFORE_DRY) poolDry = true;
            else continue roundLoop; // rotate to the next metro/phrasing and ask again
          } else {
            // Any hit at all means the rotation is still finding ground. Reset,
            // so four empties scattered across a long run never accumulate into
            // a false "exhausted".
            consecutiveEmpty = 0;
          }
        } catch (e) {
          stoppedEarlyReason = `Stopped after round ${round}: discovery failed (${(e as Error).message.slice(0, 200)})`;
          break;
        }
      }

      if (pending.length === 0) {
        // CRITICAL DISTINCTION: "this state has no more companies" and "we
        // could not search" look identical here (both yield zero candidates)
        // but mean opposite things to the person reading the result. Claiming
        // the pool is exhausted when a channel was actually blocked — by a
        // budget cap, an outage, an expired key — tells Jonathan California is
        // mined out when in fact nobody looked. Only claim exhaustion when
        // discovery genuinely ran.
        if (roundChannelErrors.length > 0) {
          stoppedEarlyReason =
            `Could not search: ${roundChannelErrors.join(" | ")}`.slice(0, 500);
        } else {
          await bump(supabase, searchId, { candidates_pool_exhausted: true });
        }
        break;
      }

      // ── consume this round's batch from the buffer ───────────────────────
      const candidates = pending.splice(0, roundLimit);
      totalScanned += candidates.length;
      await bump(supabase, searchId, {
        companies_scanned: totalScanned,
      });

      // ── 2. Fetch pages for this round's batch ────────────────────────────
      let pagesByDomain;
      try {
        pagesByDomain = await fetchCompanyPages(candidates.map((c) => c.domain));
      } catch (e) {
        stoppedEarlyReason = `Stopped after round ${round}: page fetch failed (${(e as Error).message.slice(0, 200)})`;
        break;
      }
      await bump(supabase, searchId, { pages_fetched: totalScanned });

      // ── 3. Classify -> disprove, CLASSIFY_CONCURRENCY at a time ──────────
      // Each candidate is fully independent (its own page, its own LLM calls,
      // its own row), so this was pure wasted wall-clock when serial: a real
      // 25-company run measured 364s -> ~14.6s per company, essentially all of
      // it waiting on one classify+disprove pair at a time.
      // Counter mutations below are safe without locking: Node is
      // single-threaded, so `qualified++` and friends can't interleave
      // mid-statement — only whole statements between awaits interleave.
      let targetHit = false;
      await runWithConcurrency(candidates, CLASSIFY_CONCURRENCY, async (candidate) => {
        // Target already reached by an in-flight sibling — skip the remaining
        // classify spend. (With concurrency N, up to N-1 extra companies can
        // finish past the target; their results are kept, never discarded.)
        if (targetHit) return;

        const domainPages = pagesByDomain.get(candidate.domain) ?? [];
        const page = pickBestPage(domainPages);

        // discovery_channel belongs on EVERY row, including the early
        // rejections below. It used to be set only on the full-classification
        // insert, so a candidate that failed its page fetch, came back too
        // thin, or read as "other" was stored with a null channel — and those
        // are exactly the outcomes a weak channel produces. Counting
        // discovery_channel = 'directory' therefore measured "directory
        // candidates that made it all the way to a verdict", not "candidates
        // the directory channel found", and under-reported it badly: the
        // 2026-08-07 NC run shows 3 directory rows and 5 nulls that are all
        // NARI member companies.
        const base = {
          search_id: searchId,
          domain: candidate.domain,
          // The state whose search actually surfaced this company, not
          // `states[0]`. That old default labelled every result on a
          // "California, New York, Texas, Florida" search as California — the
          // New York ones too. It made the state column wrong rather than
          // merely vague, and it hid whether a multi-state search was working
          // at all, because a genuinely broken run and a healthy one produced
          // identical output. Falls back to states[0] only for candidates that
          // carry no state of their own (the recheck channel).
          state: candidate.state ?? states[0] ?? null,
          // Free, and never captured until now: Google Places returns the city
          // in the same response as the website URL. Zero of 106 rows had one.
          city: candidate.city ?? null,
          source_url: page?.url ?? candidate.url,
          discovery_channel: candidate.channel ?? null,
          first_seen_at: new Date().toISOString(),
          last_crawled_at: new Date().toISOString(),
        };

        if (!page) {
          await supabase.from("companies").insert({
            ...base,
            name: cleanDomainName(candidate.domain),
            industry,
            status: "rejected",
            rejection_reason: "No About/Team/Leadership page could be fetched from this domain",
            recheck_after: recheckAfterFor("rejected", "could not be fetched"),
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          return;
        }

        // THIN-PAGE GUARD — a page under ~500 chars is a JS shell, a parked
        // domain, or pure nav chrome. It cannot contain a founder AND a
        // next-gen with their relationship stated, so a paid Sonnet call on
        // it has exactly one possible outcome bought at full price. Reject
        // as a fetch-quality failure (14-day recheck, same as "could not be
        // fetched") rather than paying to hear "names no individuals".
        if (page.text.length < 500) {
          await supabase.from("companies").insert({
            ...base,
            name: resolveName(page.siteName, null, candidate.domain),
            industry,
            status: "rejected",
            rejection_reason:
              "Page too thin to evaluate, likely a JS-rendered shell or placeholder page",
            recheck_after: recheckAfterFor("rejected", "could not be fetched"),
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          return;
        }

        // COMPOSITE FEED — the classifier used to see exactly ONE page, but
        // the evidence is routinely split: the founder's story lives on
        // /about while the next generation is named on /team. Russell
        // Landscape was a real, measured miss of this shape. Same 12k-char
        // budget as before, now spent across the two best DISTINCT pages
        // instead of only the first — the rubric's traps apply unchanged,
        // the model just gets to see the whole story.
        const classifyText = buildClassifyText(page, domainPages);

        let classification;
        try {
          classification = await classifySignal(candidate.title, page.url, classifyText, refinement);
        } catch (e) {
          console.warn(
            `classify failed for ${candidate.domain}: ${(e as Error).message}`.slice(0, 500)
          );
          await supabase.from("companies").insert({
            ...base,
            name: resolveName(page.siteName, null, candidate.domain),
            industry,
            status: "rejected",
            // A SENTENCE, not the exception. The thrown message is
            // `Could not parse JSON from model output: {"companyName": ...` —
            // a fragment of the model's own output — and rejection_reason is
            // now rendered verbatim on the card and shipped in the CSV, so the
            // raw string would put debug text in front of the client inside the
            // one panel whose entire argument is that a careful test ran.
            // The technical detail still goes to the server log.
            rejection_reason:
              "Could not be judged automatically. The page was read but the result came back unreadable, so it is queued to be checked again rather than counted either way.",
            recheck_after: recheckAfterFor("rejected", "classification failed"),
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          return;
        }

        // Best available source, in trust order: the page's own og:site_name
        // (unless it's a placeholder — see resolveName), then what the
        // classifier read off the page body, then a cleaned-up domain —
        // never the raw Google-search title (see openrouter.ts).
        const companyName = resolveName(page.siteName, classification.companyName, candidate.domain);

        // Stored under the search's own vertical, not the classifier's
        // read — a candidate came from a Maps category search scoped to one
        // vertical already, so this row belongs in that vertical's folder
        // regardless (the classifier's industry read is only used above to
        // catch actual mismatches, e.g. a landscape-*architecture* firm
        // with no install crews turning up in a landscaping search).
        // City resolved HERE rather than in `base`, because base is built
        // before the page is classified. Maps is authoritative when it has one;
        // otherwise take what the classifier read off the page. Web search —
        // the highest-yield channel — supplies no location at all, so without
        // this fallback the best leads in the folder showed a blank city.
        const withName = {
          ...base,
          name: companyName,
          industry,
          city: base.city ?? cleanCity(classification.city),
        };

        if (classification.industry === "other") {
          // recheck_after, like every other rejection path in this file (:599,
          // :620, :646, :833). It was the one insert that omitted it, and a
          // NULL recheck_after is read as PERMANENT by the cross-search memory
          // preload — so a company cut for being the wrong trade was cut
          // forever, and the 545-day reconsideration never applied to the one
          // rejection reason most likely to stop being true. A supplier that
          // adds install crews, or a fence contractor that moves into
          // landscaping, was invisible to every future search.
          const wrongTradeReason =
            classification.rejectionReason ?? "Outside the landscaping/home-builder ICP";
          await supabase.from("companies").insert({
            ...withName,
            status: "rejected",
            rejection_reason: wrongTradeReason,
            recheck_after: recheckAfterFor("rejected", wrongTradeReason),
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          return;
        }

        // EVIDENCE RECEIPT CHECK — the quote is the proof Jonathan is shown,
        // and until now nothing verified it actually appears on the page.
        // A fabricated or paraphrased quote is the single worst thing this
        // product could hand him: a receipt that doesn't check out. Costs
        // zero API calls; a quote that can't be found on the page the model
        // was shown drops the company to "verify" and says why.
        let quoteWarning: string | null = null;
        // Normalise before anything looks at it, so the verification below and
        // the text stored are the same string the client will read.
        if (classification.quote) {
          classification = { ...classification, quote: tidyQuote(classification.quote) };
        }
        if (classification.qualifies && classification.quote) {
          const stitched = /\.\.\.|…/.test(classification.quote) || (classification.quote.match(/"/g) ?? []).length >= 4;
          if (stitched) {
            // Keep the longest piece that actually verifies. The finding stands
            // — the fragments are real — but the receipt shown to the client
            // has to be something he can find on the page.
            const repaired = longestVerifiableQuote(classification.quote, classifyText, [
              classification.nextGenName,
              classification.founderName,
            ]);
            classification = { ...classification, quote: repaired };
            if (!repaired) {
              quoteWarning =
                "No single continuous passage on the page could be quoted as evidence, flagged for manual verification.";
              classification = { ...classification, confidence: "verify" as const };
            }
          } else if (!quoteAppears(classification.quote, classifyText)) {
            quoteWarning =
              "Evidence quote could not be located verbatim on the fetched page, flagged for manual verification.";
            classification = { ...classification, confidence: "verify" as const };
          }
        }

        // What the classifier actually found, independent of what this
        // search's mode requires — 'signal' mode gates on it below; 'filter'
        // and 'hybrid' don't, but still capture it (hybrid ranks on it,
        // filter just records it as a bonus fact).
        const hasSignal = classification.qualifies;

        // ICP-fit acceptance: 'signal' mode requires a real signal on top of
        // category fit (unchanged original behavior); 'filter'/'hybrid' only
        // need category fit, already confirmed by the industry !== "other"
        // check above — a plain landscaping company with no succession
        // event is a perfectly good result in those two modes.
        let finalQualifies = mode === "signal" ? hasSignal : true;
        let finalConfidence = classification.confidence;
        let rejectionReason = classification.rejectionReason;
        let disproveNotes: string | null = null;
        // Whether the signal tag survives the disprove pass. Only matters
        // when hasSignal is true to begin with; a filter/hybrid company
        // accepted purely on category fit never had a signal claim to lose.
        let signalStands = hasSignal;

        // Size + current-ownership gates apply in every mode — these are
        // ICP-definition checks (revenue band, still family-run), not
        // signal-authenticity checks, so they cut a filter/hybrid "just
        // category fit" acceptance exactly the same as a signal-mode one.
        // SIZE IS NO LONGER A GATE (2026-08-06, per instruction "start broad,
        // don't limit him"). sizeFit/revenueEstimate are still captured on
        // every row and shown in the UI so the band can be eyeballed or
        // filtered after the fact — but a company is no longer REJECTED for
        // reading too small or too big. Rationale: revenue is being estimated
        // from soft textual proxies (years in business, crew size, service
        // area), not real financials, so cutting on it was throwing away
        // real companies on a guess. Note this deliberately diverges from the
        // delivered proof, which did cut "Too small"/"Too big" — so expect to
        // see companies outside $3-15M in results until Jonathan confirms the
        // band he actually wants. Re-enable by restoring the two branches
        // below (git history: this commit) once that's settled.
        // Band check, on the NUMBER rather than the model's verdict.
        //
        // This was the single biggest cut in the funnel — 21 of 77 rejections
        // (27%), more than wrong-trade and not-family-owned combined — and it
        // was the least defensible one. It fired on `sizeFit`, a bare
        // too_small/too_big judgement the model forms from soft textual proxies
        // (crew size, years in business, service area), not from financials.
        // Reviewing all 21 live: ELEVEN had no revenue figure recorded at all,
        // so they were cut on a guess with nothing behind it. Two of those were
        // named "Two Generations Landscaping" and "Third Generation Lawn &
        // Landscape" — businesses advertising multi-generational family
        // ownership in their own names, which is the exact ICP, thrown away on
        // an unevidenced size hunch.
        //
        // Now it cuts only when there is a real estimated RANGE and that range
        // cannot overlap the requested band. A company read as "$1-3M" against
        // a $3-15M band is kept, because $3M is inside both. No estimate means
        // no cut, ever: an unknown is not evidence of being too small.
        //
        // Recovers 20 of those 21 against live data. The asymmetry justifies
        // it — keeping a slightly-out-of-band company costs one row he can
        // ignore, while cutting a real one loses a lead permanently and
        // invisibly. sizeFit and revenueEstimate are still recorded on every
        // row, so the band remains filterable after the fact.
        const bandSet = !!band && (band.min !== null || band.max !== null);
        const estimate = parseRevenueBand(classification.revenueEstimate);
        const belowBand =
          bandSet && band!.min !== null && estimate !== null && estimate.hi < band!.min;
        const aboveBand =
          bandSet && band!.max !== null && estimate !== null && estimate.lo > band!.max;

        // Geography gate — the client works only with US companies. Listed
        // FIRST because it is the most decisive cut: a British landscaper is
        // not a lead however family-run, well-sized and mid-succession it is,
        // so there is no point paying for a disprove pass on it.
        //
        // Fires ONLY on the literal "foreign" — an explicit positive read that
        // the business operates outside the US. "unknown" (the common answer),
        // "us", a missing field on an older cached row, and anything the model
        // returns off-schema all fall through and keep the company. The
        // classify result is a plain JSON cast with no validation, so
        // `undefined` here is a real case, not a theoretical one, and it must
        // mean "keep" — the whole design of this filter is that the expensive
        // error is cutting a real US lead on a page that simply never
        // mentioned where it is.
        if (finalQualifies && classification.operatingCountry === "foreign") {
          finalQualifies = false;
          rejectionReason =
            "Outside the US, the page shows this business operating in another country.";
        } else if (finalQualifies && !classification.stillFamilyOwned) {
          finalQualifies = false;
          rejectionReason =
            "No longer family-owned, acquired/consolidated, current leadership shows no family members.";
        } else if (finalQualifies && belowBand) {
          finalQualifies = false;
          rejectionReason = `Too small, reads below the $${band!.min}M lower bound set for this search.`;
        } else if (finalQualifies && aboveBand) {
          finalQualifies = false;
          rejectionReason = `Too big, reads above the $${band!.max}M upper bound set for this search.`;
        } else if (finalQualifies && hasSignal) {
          // Only worth running the disprove pass when there's an actual
          // signal claim to check — a filter/hybrid company accepted purely
          // on category fit has nothing for it to disprove.
          try {
            // Sees the same composite text classify saw — refuting a claim
            // against LESS text than it was made from would invent
            // contradictions out of missing context.
            const disprove = await disprovePass(companyName, classification, classifyText);
            disproveNotes = disprove.notes;
            if (!disprove.holds) {
              signalStands = false;
              if (mode === "signal") {
                // 'signal' mode has nothing left to accept it on — the
                // whole point of the row was the signal, and it just failed.
                finalQualifies = false;
                rejectionReason = disprove.revisedRejectionReason ?? "Did not hold up to the disprove pass";
              }
              // filter/hybrid: the signal claim didn't hold up, but the
              // company still fits the ICP on category/size/ownership alone
              // — keep it as a fit-only result rather than rejecting a
              // perfectly good company over a signal it never needed.
            } else {
              finalConfidence = disprove.revisedConfidence ?? classification.confidence;
            }
          } catch (e) {
            disproveNotes = `Disprove pass failed to run: ${(e as Error).message}`;
            // Couldn't verify the claim either way — don't let an unverified
            // signal ride into 'qualified'/'verify'; fall back to treating
            // it as fit-only in filter/hybrid, and to the original
            // classifier confidence (unchanged) in signal mode as before.
            if (mode !== "signal") signalStands = false;
          }
        }

        // A succession claim requires two people Jonathan can look up. If the
        // page never gave a full name for both, the pair is not confirmed —
        // the company stays a fit lead, but it stops claiming a signal it
        // cannot support. See callableName.
        // Cleaned ONCE, here, so the pair test, the confidence gate and the
        // stored row all judge the same string. See cleanPersonName — a name
        // field occasionally arrives holding the sentence the person was found
        // in ("Joe Harris started the family's lumber business").
        const founderName = cleanPersonName(classification.founderName);
        const nextGenName = cleanPersonName(classification.nextGenName);
        const bothCallable = callableName(founderName) && callableName(nextGenName);
        const finalHasSignal = hasSignal && signalStands && bothCallable;

        const { data: inserted, error: insertErr } = await supabase
          .from("companies")
          .insert({
            ...withName,
            status: finalQualifies ? "qualified" : "rejected",
            // The label the lead has EARNED, which may be lower than the one
            // the model claimed. "High" promises Jonathan can act without
            // checking; two leads carried it on a shared surname and an absent
            // quote. See earnedConfidence.
            confidence:
              finalQualifies && finalHasSignal
                ? earnedConfidence(finalConfidence, classification.quote, founderName, nextGenName)
                : null,
            has_signal: finalQualifies ? finalHasSignal : null,
            operating_model: classification.operatingModel ?? null,
            rejection_reason: finalQualifies ? null : rejectionReason,
            // Schedules (or declines) the next look — see recheck-policy.ts.
            recheck_after: recheckAfterFor(
              finalQualifies ? "qualified" : "rejected",
              finalQualifies ? null : rejectionReason
            ),
            // Only a real figure reaches the sheet — see cleanRevenueBand.
            revenue_band: cleanRevenueBand(classification.revenueEstimate),
            founder_name: founderName,
            founder_title: cleanTitle(classification.founderTitle),
            next_gen_name: nextGenName,
            next_gen_title: cleanTitle(classification.nextGenTitle),
          })
          .select("id")
          .single();

        if (insertErr || !inserted) {
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          return;
        }

        // Phone, written separately and best-effort ON PURPOSE. It needs a
        // column this codebase cannot create (no psql, no CLI, no database
        // password here), and folding it into the insert above would mean a
        // company is LOST entirely on a database where the migration has not
        // been applied. A missing phone number is a missing field; a missing
        // company is a missing lead.
        //
        // FALLING BACK TO THE PAGE. Google Places supplies a number for 81% of
        // Maps companies and 0% of web-search ones — and web search is the
        // channel that actually finds confirmed pairs (4.8 per 100 read against
        // Maps' 0.9). So the leads most worth ringing were precisely the ones
        // showing no number, while the page had it in the footer the whole
        // time. Places stays authoritative where it has one; this only fills a
        // blank, and costs nothing — the page is already fetched and paid for.
        const pagePhone = candidate.phone ? null : bestPhoneFor(classifyText);
        if (candidate.phone || candidate.address || pagePhone) {
          const patch: { phone?: string; address?: string } = {};
          if (candidate.phone || pagePhone) patch.phone = candidate.phone ?? pagePhone!;
          if (candidate.address) patch.address = candidate.address;
          const { error: contactErr } = await supabase
            .from("companies")
            .update(patch)
            .eq("id", inserted.id);
          if (contactErr && /phone|address/.test(contactErr.message ?? "")) {
            phoneColumnMissing = true;
          }
        }

        if (classification.quote && finalHasSignal) {
          await supabase.from("signal_evidence").insert({
            company_id: inserted.id,
            quote: classification.quote,
            source_url: page.url,
            page_type: classification.pageType,
            disprove_notes: [quoteWarning, disproveNotes].filter(Boolean).join(" | ") || null,
          });
        }

        if (!finalQualifies) {
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          return;
        }

        // FREE EMAIL, PARKED, NOT SHOWN.
        //
        // The page this company was just judged from is still in memory, and
        // plenty of trade sites print an address on it. Reading it here costs
        // nothing; the same read during enrichment costs a $0.013 re-fetch,
        // and paying AnymailFinder $0.05 for an address already sitting on the
        // page is worse still.
        //
        // Written with find_status 'not_attempted', which is the honest state:
        // we have a CANDIDATE, the lookup step has not run. The UI shows an
        // email only at 'found', so nothing appears in the folder until he
        // presses Enrich — the two-step flow stays true, and an unpressed
        // Enrich button never sits above a list that already has emails in it.
        //
        // Only for accepted companies. A rejected one is not a lead, and a
        // contacts row on it would make enrichment think it had been handled.
        if (finalQualifies) {
          const parked = bestEmailFor(extractEmails(classifyText), candidate.domain, [
            classification.nextGenName,
            classification.founderName,
          ]);
          if (parked) {
            await supabase.from("contacts").insert({
              company_id: inserted.id,
              email: parked.email,
              name: parked.matchedName,
              name_inferred: parked.matchedName !== null,
              title: parked.matchedName
                ? classification.nextGenTitle ?? classification.founderTitle
                : null,
              find_status: "not_attempted",
              find_source: `company-page:${parked.kind}`,
              verification_status: "not_attempted",
            });
          }
        }

        if (finalHasSignal) {
          if (finalConfidence === "verify") verify++;
          else qualified++;
        } else {
          fitOnly++;
        }
        accepted = qualified + verify + fitOnly;
        await bump(supabase, searchId, {
          qualified_count: qualified,
          verify_count: verify,
          fit_only_count: fitOnly,
        });

        // Contact enrichment (Anymailfinder + MillionVerifier) is a
        // separate, manually-triggered step now — see enrichContacts()
        // below and app/api/search/[id]/enrich/route.ts. Discovery just
        // stores who to look up (next_gen_name/founder_name, already on
        // this row) and stops here.

        // Target hit mid-round — the rest of this batch was already
        // discovered/fetched (sunk cost), but skip further classify spend.
        if (countsTowardTarget() >= targetSignals) targetHit = true;
      }, outOfTime);

      if (targetHit) break roundLoop;
      // No trailing exhaustion check here — the buffer refill at the top of
      // the loop is the single place that decides "pool dry" now, and it does
      // so only when a real discovery call came back empty-handed.
    }

    // A round-level hiccup (caught above) still ends in status: 'complete' —
    // whatever was found and saved is real and shown as-is; the note just
    // explains why the count may fall short of the target. Only an error
    // outside the round loop (e.g. the DB itself) reaches the outer catch
    // and produces a genuine status: 'failed'.
    if (phoneColumnMissing) {
      console.warn(
        `Search ${searchId}: phone/address were discovered but not saved, a column is missing. Apply supabase/migrations/20260809010000_company_phone.sql.`
      );
    }

    await bump(supabase, searchId, {
      status: "complete",
      error_message: stoppedEarlyReason,
      // Separate from error_message on purpose: this run SUCCEEDED, it just
      // searched a smaller surface than it looks like it did.
      warnings: buildWarningLine(degradedChannels),
      cost_estimate_usd: estimateUsd(costCounters),
      cost_breakdown: describeCost(costCounters) || null,
      finished_at: new Date().toISOString(),
    });
  } catch (e) {
    await bump(supabase, searchId, {
      status: "failed",
      error_message: (e as Error).message?.slice(0, 500) ?? "Unknown error",
      // Even a failed run spent money — record what it got through.
      cost_estimate_usd: estimateUsd(costCounters),
      cost_breakdown: describeCost(costCounters) || null,
      finished_at: new Date().toISOString(),
    });
  }
  });
}

/**
 * Turns this enrich pass's counters into a cost patch that ADDS to whatever
 * the search row already carries.
 *
 * Why additive: discovery wrote its own total when it finished, and
 * enrichment is a second pass over that same row — writing estimateUsd()
 * straight in would erase the discovery spend and make every enriched search
 * look like it only ever cost the emails. Re-runnable, too (see below), so a
 * second pass has to stack on the first rather than replace it.
 *
 * Refetched at write time rather than read once at the top of the pass, for
 * the same reason: what matters is what's on the row at the moment we write.
 */
async function addEnrichmentCost(
  supabase: Supa,
  searchId: string,
  counters: CostCounters
): Promise<Partial<SearchRow>> {
  try {
    const { data } = await supabase
      .from("searches")
      .select("cost_estimate_usd, cost_breakdown")
      .eq("id", searchId)
      .single();

    const priorUsd = data?.cost_estimate_usd ?? 0;
    const priorLine = data?.cost_breakdown ?? null;
    const line = describeCost(counters);

    return {
      // Re-rounded after the addition — two values each rounded to 3 decimals
      // still add up to float noise (0.30000000000000004) otherwise.
      cost_estimate_usd: Math.round((priorUsd + estimateUsd(counters)) * 1000) / 1000,
      // A pass that bought nothing (every contact reused from a known domain,
      // or nothing left to enrich) describes as "" — leave the discovery line
      // exactly as it was instead of appending a dangling separator.
      cost_breakdown: line ? (priorLine ? `${priorLine} · ${line}` : line) : priorLine,
    };
  } catch {
    // Couldn't read the existing total. Degrade to "this pass's spend isn't
    // recorded" rather than writing enrichment-only figures over a run's real
    // cost — under-reporting is recoverable, a clobbered total is not.
    return {};
  }
}

// Step 2 of the two-step flow — a manually-triggered pass over whatever a
// completed search accepted (status: 'qualified', any mode/tier: qualified,
// verify, or fit-only). Runs the same findContact/verifyEmail logic that
// used to be inline in the discovery loop above, just decoupled so
// enrichment spend only happens when someone actually clicks the button —
// see app/api/search/[id]/enrich/route.ts.
//
// Safe to re-run: only enriches companies from this search that don't
// already have a contacts row, so a retry after a partial failure (or just
// running it again later) never re-queries someone already looked up.
/**
 * Which accepted companies to buy contact details for.
 *
 *   "signals" — only companies where a founder/next-gen pair was actually
 *      found. The strict list, and the cheapest.
 *   "all"     — every company that fits the ICP, signal or not.
 *
 * This is a SPENDING choice and it belongs to the operator, not to the code.
 * On the current data the two differ by 8x — 15 signals against 124 ICP fits,
 * roughly $0.75 versus $6.20 at AnymailFinder's ~$0.05 per found address, out
 * of a few hundred credits. It used to always enrich everything accepted,
 * which is the expensive branch chosen silently.
 *
 * "all" is a perfectly reasonable default for a coach who is happy to open a
 * conversation with a good family business that simply hasn't published its
 * succession story — the signal is what makes the call TIMELY, not what makes
 * the company a fit.
 */
/**
 * "selected" is an explicit list of company ids, so the choice of who to look
 * up can be made per company rather than only per folder — including companies
 * the pipeline REJECTED, which are visible now and are sometimes worth an
 * address anyway (a cut on revenue says nothing about whether the founder is
 * handing over).
 */
export type EnrichScope = "signals" | "all" | "selected";

/**
 * Last resort before recording "no contact": read the company's own page.
 *
 * Costs one crawl ($0.013) and only ever runs on a company the paid lookup
 * already failed on, so it can never make a successful enrichment more
 * expensive. Returns null on any failure — a contact we could not find is the
 * status quo, and it is not worth failing the batch over.
 */
async function emailFromCompanyPage(
  domain: string,
  sourceUrl: string | null,
  targetNames: (string | null)[]
): Promise<FoundEmail | null> {
  const url = sourceUrl ?? `https://${domain}`;
  try {
    const text = await fetchSingleUrl(url);
    if (!text) return null;
    return bestEmailFor(extractEmails(text), domain, targetNames);
  } catch {
    return null;
  }
}

export async function enrichContacts(
  searchId: string,
  scope: EnrichScope = "all",
  companyIds?: string[]
) {
  const supabase = createServiceRoleClient();

  // Enrichment gets its OWN counters, separate from the discovery run's — the
  // two passes happen in different requests (and often days apart), so there
  // is no shared store to record into. Anymailfinder/MillionVerifier spend was
  // simply invisible before this: the cost on the search row was the discovery
  // total and nothing else, while the enrich button quietly bought emails at
  // ~$0.05 each. Totals are folded into the row's existing cost below.
  const enrichCounters: CostCounters = { counts: {} };
  await runWithCounters(enrichCounters, async () => {
  try {
    const { data: search } = await supabase
      .from("searches")
      .select("contacts_found, contacts_verified")
      .eq("id", searchId)
      .single();
    let contactsFound = search?.contacts_found ?? 0;
    let contactsVerified = search?.contacts_verified ?? 0;

    // `.eq("has_signal", true)` rather than filtering in JS: a search with 300
    // accepted companies would otherwise pull all 300 rows over the wire to
    // discard most of them.
    let companiesQuery = supabase
      .from("companies")
      .select("id, domain, next_gen_name, next_gen_title, founder_name, founder_title, source_url")
      // Kept on EVERY branch, including "selected". It is what stops a crafted
      // request enriching another folder's companies by id, and it is the
      // reason the selected branch can safely drop the status filter.
      .eq("search_id", searchId);
    if (scope === "selected") {
      // No status filter: an explicit pick means the user has already decided,
      // and a rejected company is a legitimate thing to want an address for.
      companiesQuery = companiesQuery.in("id", companyIds ?? []);
    } else {
      companiesQuery = companiesQuery.eq("status", "qualified");
      if (scope === "signals") companiesQuery = companiesQuery.eq("has_signal", true);
    }
    const { data: companies, error: companiesErr } = await companiesQuery;
    if (companiesErr) throw companiesErr;

    const { data: existingContacts } = await supabase
      .from("contacts")
      .select("company_id, email, find_status, find_source")
      .in("company_id", (companies ?? []).map((c) => c.id));

    // A row at 'not_attempted' is a PARKED CANDIDATE scraped free off the page
    // at classify time, not a finished lookup. Treating any contacts row as
    // "already enriched" would have made the free scrape actively harmful:
    // every company that happened to print an address would be skipped
    // forever, its email never revealed and no lookup ever run.
    const settled = (existingContacts ?? []).filter((c) => c.find_status !== "not_attempted");

    // A SHARED INBOX IS NOT AN ENRICHED COMPANY.
    //
    // info@ / office@ / contact@ is a real, usable address and worth keeping —
    // but it is not what this product is for. Jonathan opens conversations
    // about handing a family business to a child, the most personal subject a
    // business owner has. info@ reaches whoever screens the inbox; will@
    // reaches Will.
    //
    // Treating info@ as "done" meant one free scrape off a footer permanently
    // cancelled the paid lookup that would have found the founder by name —
    // the company looked enriched, and the address Jonathan actually needed
    // was never bought. So a company whose only settled contact is a shared
    // inbox stays eligible. Both rows are kept: the personal address becomes
    // the contact, the shared one remains as a fallback.
    const enrichedCompanies = new Set<string>();
    for (const c of settled) {
      const personal = c.find_status === "found" && c.email && !isSharedInbox(c.email);
      // "not_found" still counts as settled — the lookup ran and came back
      // empty, and re-running it changes nothing but the bill.
      if (personal || c.find_status === "not_found") enrichedCompanies.add(c.company_id);
    }
    const alreadyEnriched = enrichedCompanies;
    const parkedByCompany = new Map(
      (existingContacts ?? [])
        .filter((c) => c.find_status === "not_attempted" && c.email)
        .map((c) => [c.company_id, c])
    );

    // Reuse an email we already bought for this DOMAIN, even if it was found
    // under a different search. Companies are stored per (search, domain), so
    // a re-check months later creates a NEW row for a domain we may already
    // have a verified contact for — enriching it again would spend a second
    // AnymailFinder credit to learn the same address. That matters: the
    // account has hundreds of credits, not thousands.
    const domains = Array.from(new Set((companies ?? []).map((c) => c.domain).filter(Boolean)));
    const knownByDomain = new Map<string, { email: string | null; name: string | null; title: string | null; verification_status: string; name_inferred: boolean }>();
    if (domains.length > 0) {
      const { data: priorRows } = await supabase
        .from("companies")
        .select("domain, contacts(email, name, title, verification_status, name_inferred, find_status)")
        .in("domain", domains);
      (priorRows ?? []).forEach((row: { domain: string; contacts?: unknown }) => {
        const list = (row.contacts ?? []) as Array<{
          email: string | null; name: string | null; title: string | null;
          verification_status: string; name_inferred: boolean; find_status: string;
        }>;
        // Only reuse a real find — never cache "not_found" as if it were an
        // answer, since a company that had no discoverable email last quarter
        // may well have one now.
        const hit = list.find((c) => c.find_status === "found" && c.email);
        if (hit && !knownByDomain.has(row.domain)) knownByDomain.set(row.domain, hit);
      });
    }

    const toEnrich = (companies ?? []).filter((c) => !alreadyEnriched.has(c.id));

    for (const company of toEnrich) {
      try {
        // A parked candidate that already belongs to the person we want —
        // it matched the founder's or successor's name off their own page.
        // AnymailFinder cannot beat that, so promote it and spend nothing.
        // Verification still runs: $0.006 to know whether it delivers is
        // worth it against $0.05 to look up an address we already have.
        const parked = parkedByCompany.get(company.id);
        if (parked?.email && String(parked.find_source).endsWith(":person_match")) {
          const verification = await verifyEmail(parked.email).catch(() => "unknown" as const);
          await supabase
            .from("contacts")
            .update({
              find_status: "found",
              verification_status: verification,
              verification_source: "millionverifier",
              verified_at: new Date().toISOString(),
            })
            .eq("company_id", company.id)
            .eq("find_status", "not_attempted");
          contactsFound++;
          if (verification === "valid") contactsVerified++;
          await bump(supabase, searchId, { contacts_found: contactsFound, contacts_verified: contactsVerified });
          continue;
        }

        // Domain already has a purchased contact — copy it forward instead of
        // paying to rediscover it.
        const known = knownByDomain.get(company.domain);
        if (known) {
          await supabase.from("contacts").insert({
            company_id: company.id,
            name: known.name,
            name_inferred: known.name_inferred,
            title: known.title,
            email: known.email,
            find_status: "found",
            find_source: "reused-known-domain",
            verification_status: known.verification_status as never,
            verification_source: "reused-known-domain",
            verified_at: new Date().toISOString(),
          });
          contactsFound++;
          if (known.verification_status === "valid") contactsVerified++;
          await bump(supabase, searchId, { contacts_found: contactsFound, contacts_verified: contactsVerified });
          continue;
        }

        // Any parked candidate left at this point is a shared inbox or an
        // unmatched address. AnymailFinder is still worth trying, because a
        // named person beats info@ for someone whose whole pitch is reaching
        // the founder by name — and it only bills on success, so the attempt
        // is free. Whatever wins replaces the parked row rather than sitting
        // beside it, so a company never ends up with two contacts.
        if (parked) {
          await supabase.from("contacts").delete().eq("company_id", company.id).eq("find_status", "not_attempted");
        }

        const targetName = company.next_gen_name ?? company.founder_name ?? null;
        const contact = await findContact(company.domain, targetName);
        if (contact.found && contact.email) {
          const verification = await verifyEmail(contact.email).catch(() => "unknown" as const);
          await supabase.from("contacts").insert({
            company_id: company.id,
            name: contact.name,
            name_inferred: contact.nameInferred,
            title: contact.nameInferred ? null : company.next_gen_title ?? company.founder_title,
            email: contact.email,
            find_status: "found",
            find_source: "anymailfinder",
            verification_status: verification,
            verification_source: "millionverifier",
            verified_at: new Date().toISOString(),
          });
          contactsFound++;
          if (verification === "valid") contactsVerified++;
        } else {
          // The paid lookup came back empty, which costs nothing (the vendor
          // bills only on a find) and used to end the story: a company he wants
          // to call, with no way to reach it. Read its own page before giving
          // up — most small trade sites print an address in plain text.
          // Prefer the candidate already read off this page at classify time.
          // Re-fetching to learn the same address would spend $0.013 to
          // rediscover something already in the database.
          const scraped = parked?.email
            ? {
                email: parked.email,
                kind: String(parked.find_source).split(":")[1] ?? "role",
                matchedName: null,
              }
            : await emailFromCompanyPage(company.domain, company.source_url, [
                company.next_gen_name,
                company.founder_name,
              ]);
          if (scraped) {
            const verification = await verifyEmail(scraped.email).catch(() => "unknown" as const);
            await supabase.from("contacts").insert({
              company_id: company.id,
              // Only claim a name when the address actually carries one. A
              // shared inbox is not the founder, and labelling it as him is
              // how a mail-merge opens "Hi Michael" to reception.
              name: scraped.matchedName,
              name_inferred: scraped.matchedName !== null,
              title: scraped.matchedName ? company.next_gen_title ?? company.founder_title : null,
              email: scraped.email,
              find_status: "found",
              find_source: `company-page:${scraped.kind}`,
              verification_status: verification,
              verification_source: "millionverifier",
              verified_at: new Date().toISOString(),
            });
            contactsFound++;
            if (verification === "valid") contactsVerified++;
          } else {
            await supabase.from("contacts").insert({
              company_id: company.id,
              find_status: "not_found",
              find_source: "anymailfinder+company-page",
            });
          }
        }
      } catch (e) {
        // One company's vendor hiccup doesn't stop the rest of the batch —
        // it just stays unenriched and picks up on the next run (no
        // contacts row was inserted, so alreadyEnriched won't skip it).
        console.warn(`Search ${searchId}: contact enrichment failed for ${company.domain}: ${(e as Error).message}`);
      }
      await bump(supabase, searchId, { contacts_found: contactsFound, contacts_verified: contactsVerified });
    }

    await bump(supabase, searchId, {
      enrichment_status: "complete",
      ...(await addEnrichmentCost(supabase, searchId, enrichCounters)),
    });
  } catch (e) {
    await bump(supabase, searchId, {
      enrichment_status: "failed",
      enrichment_error: (e as Error).message?.slice(0, 500) ?? "Unknown error",
      // A pass that died halfway still bought whatever it bought — same rule
      // the discovery run's catch follows.
      ...(await addEnrichmentCost(supabase, searchId, enrichCounters)),
    });
  }
  });
}
