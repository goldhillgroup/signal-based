import { createServiceRoleClient } from "../supabase/server";
import { discoverCandidates, fetchCompanyPages, pickBestPage, fetchSingleUrl, type Candidate, type FetchedPage } from "./apify";
import { classifySignal, disprovePass } from "./openrouter";
import { findContact } from "./anymailfinder";
import { verifyEmail } from "./millionverifier";
import type { Industry, SearchMode, SearchRow } from "../supabase/types";
import { recheckAfterFor, rejectionScope, sizeVerdictStillBinds, parseRevenueBand } from "./recheck-policy";
import { extractEmails, bestEmailFor, type FoundEmail } from "./page-email";
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
const MAX_SCAN_MULTIPLIER = 6; // never scan more than target * this
const ABSOLUTE_SCAN_CEILING = 240; // hard stop regardless of target, cost/time sanity

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
  run: (item: T) => Promise<void>
) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
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
export function buildClassifyText(primary: FetchedPage, all: FetchedPage[]): string {
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

export async function runSearchPipeline(
  searchId: string,
  industry: Industry,
  states: string[],
  targetSignals: number,
  mode: SearchMode = "signal",
  // Optional free-text focus from the search form. Passed to classification
  // as a non-overriding hint only — see classifySignal in openrouter.ts. It
  // deliberately does NOT touch discovery: letting free text steer which
  // companies get found is exactly how a search drifts off the agreed
  // vertical, which the structured vertical+state inputs exist to prevent.
  refinement?: string | null,
  // Step 01's revenue band, per-search. Both null = no limit. Applied as a
  // SOFT gate: a company only gets cut when the classifier's own size read
  // actively contradicts the chosen band — never on "unknown", since that
  // estimate comes from soft textual proxies (crew size, years in business),
  // not real financials, and cutting on a guess discards real companies.
  band?: { min: number | null; max: number | null }
) {
  const supabase = createServiceRoleClient();

  // Meter every vendor call this run makes (see cost-tracker.ts) — the totals
  // land on the search row so each run's spend is a visible number, not a
  // dashboard archaeology project.
  const costCounters: CostCounters = { counts: {} };
  await runWithCounters(costCounters, async () => {
  try {
    const scanCeiling = Math.min(targetSignals * MAX_SCAN_MULTIPLIER, ABSOLUTE_SCAN_CEILING);

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
      skippedRecent = seenDomains.size;
      console.log(
        `Search ${searchId}: cross-search memory holds ${skippedRecent} settled domains, these are skipped, everything due for re-check is fair game.` +
          (reopened > 0
            ? ` ${reopened} more were judged by a search with different criteria and are back in play here.`
            : "")
      );
    }

    let totalScanned = 0;
    let qualified = 0; // signal found, confidence high/medium (or fit-only accepted in filter/hybrid, no signal)
    let verify = 0; // signal found, confidence verify
    let fitOnly = 0; // filter/hybrid only: accepted on ICP fit, no signal found
    let accepted = 0; // qualified + verify + fitOnly, the denominator filter/hybrid targets against
    let rejected = 0;

    // What counts toward the target differs by mode:
    //  - 'signal': only companies with a real, confirmed succession signal
    //    (qualified + verify) count — a plain ICP-fit company doesn't move
    //    the needle. Unchanged from the original behavior.
    //  - 'filter' / 'hybrid': ICP fit alone is enough to accept a company, so
    //    the target means "how many companies," full stop — accepted counts
    //    every non-rejected company regardless of whether it happened to
    //    show a signal.
    const countsTowardTarget = () => (mode === "signal" ? qualified + verify : accepted);
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
          });
          if (channelErrors.length > 0) {
            roundChannelErrors = channelErrors;
            channelErrors.forEach((e) => degradedChannels.add(e));
            console.warn(`Search ${searchId} discovery ${discoveryCalls}: ${channelErrors.join(" | ")}`);
          }
          // Claimed for this search the moment they enter the buffer, so the
          // next discovery call can't re-return (or re-bill) them.
          fresh.forEach((c) => seenDomains.add(c.domain));
          pending.push(...fresh);
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
          await supabase.from("companies").insert({
            ...base,
            name: resolveName(page.siteName, null, candidate.domain),
            industry,
            status: "rejected",
            rejection_reason: `Classification failed: ${(e as Error).message}`.slice(0, 500),
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
        const withName = { ...base, name: companyName, industry };

        if (classification.industry === "other") {
          await supabase.from("companies").insert({
            ...withName,
            status: "rejected",
            rejection_reason: classification.rejectionReason ?? "Outside the landscaping/home-builder ICP",
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
        if (classification.qualifies && classification.quote && !quoteAppears(classification.quote, classifyText)) {
          quoteWarning =
            "Evidence quote could not be located verbatim on the fetched page, flagged for manual verification.";
          classification = { ...classification, confidence: "verify" as const };
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

        const finalHasSignal = hasSignal && signalStands;

        const { data: inserted, error: insertErr } = await supabase
          .from("companies")
          .insert({
            ...withName,
            status: finalQualifies ? "qualified" : "rejected",
            confidence: finalQualifies && finalHasSignal ? finalConfidence : null,
            has_signal: finalQualifies ? finalHasSignal : null,
            operating_model: classification.operatingModel ?? null,
            rejection_reason: finalQualifies ? null : rejectionReason,
            // Schedules (or declines) the next look — see recheck-policy.ts.
            recheck_after: recheckAfterFor(
              finalQualifies ? "qualified" : "rejected",
              finalQualifies ? null : rejectionReason
            ),
            revenue_band: classification.revenueEstimate,
            founder_name: classification.founderName,
            founder_title: classification.founderTitle,
            next_gen_name: classification.nextGenName,
            next_gen_title: classification.nextGenTitle,
          })
          .select("id")
          .single();

        if (insertErr || !inserted) {
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          return;
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
      });

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
export type EnrichScope = "signals" | "all";

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

export async function enrichContacts(searchId: string, scope: EnrichScope = "all") {
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
      .eq("search_id", searchId)
      .eq("status", "qualified");
    if (scope === "signals") companiesQuery = companiesQuery.eq("has_signal", true);
    const { data: companies, error: companiesErr } = await companiesQuery;
    if (companiesErr) throw companiesErr;

    const { data: existingContacts } = await supabase
      .from("contacts")
      .select("company_id")
      .in("company_id", (companies ?? []).map((c) => c.id));
    const alreadyEnriched = new Set((existingContacts ?? []).map((c) => c.company_id));

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
          const scraped = await emailFromCompanyPage(
            company.domain,
            company.source_url,
            [company.next_gen_name, company.founder_name]
          );
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
