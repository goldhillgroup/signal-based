/**
 * Which previously-seen companies are worth reading AGAIN, and what happens to
 * the record afterwards.
 *
 * WHY THIS FILE EXISTS. Measured on the live database on 2026-10-13, the
 * re-check mechanism was the single biggest reason a search returned so little:
 *
 *   - 205 of the 209 rows past their re-check date were dead or bot-blocked
 *     domains ("could not be fetched", "page too thin", "could not be judged"),
 *     not companies anybody had actually weighed.
 *   - Nothing ever moved a row's date forward after it was re-read, so the SAME
 *     alphabetically-first domains came due on every search. 247firealarm
 *     services.com, admiralpest.com and a-1exterminators.com were each re-read in
 *     9 of the last 10 searches.
 *   - They were put at the FRONT of the queue, ahead of any fresh discovery, and
 *     a dead domain is the slowest thing in the pipeline (a bot-blocked site
 *     walks through the free fetch, two Firecrawl renders and an Apify crawl
 *     before giving up). Five of the last twelve searches spent their entire
 *     four-minute pass on those eleven domains and read nothing new.
 *   - Each continuation pass re-inserted them into the same folder, collided
 *     with the unique (search, domain) index, and the run counted every one as
 *     a fresh rejection anyway. Scanned went 11, 22, 33 ... 66 against a folder
 *     that never held more than 11 rows, which then tripped the continuation
 *     ceiling and ended the search.
 *   - Across folders the same company was inserted again each time: 110 domains
 *     appear in more than one row, 14 of them as a qualified lead in several
 *     lists, one of them (acmewire.com) eleven times. That is the duplicate
 *     leads in the exports.
 *
 * Everything that decides those things is here, as plain functions, so the
 * behaviour can be tested without a database, a vendor key, or a live run.
 */

export interface DueRow {
  domain: string;
  source_url: string | null;
  state: string | null;
  rejection_reason: string | null;
  recheck_after: string | null;
  first_seen_at: string | null;
}

/** "www.Example.com" and "example.com" are one company. */
export function normDomain(d: string | null | undefined): string {
  return (d ?? "").trim().toLowerCase().replace(/^www\./, "");
}

/**
 * Rejections that say nothing about the COMPANY: the page never loaded, came
 * back empty, or the model's reply could not be read. Matches the same wording
 * recheck-policy.ts schedules at 14 days.
 */
const FETCH_FAILURE_RE =
  /could not be fetched|could not be judged|classification failed|too thin|page not found|\b404\b|returned a \d+ error|empty placeholder|essentially empty|no content available|placeholder content|no about\/team|project blog post/i;

export function isFetchFailure(reason: string | null | undefined): boolean {
  return !!reason && FETCH_FAILURE_RE.test(reason);
}

export interface PickOptions {
  /** Domains already settled elsewhere, or already present in THIS folder. */
  skip: Set<string>;
  /** Most re-checks one pass may spend. */
  cap: number;
  /**
   * Of those, how many may be fetch failures. A dead domain costs the most and
   * returns the least, so it gets a small, fixed allowance rather than whatever
   * is left over.
   */
  failureCap?: number;
  /** Hosts that can never be a lead (platforms, media, junk). */
  junk?: (domain: string) => boolean;
}

/**
 * Choose the re-checks for one pass.
 *
 * Companies that were actually JUDGED come first: "only one generation named"
 * is precisely the fact that changes when a son or daughter joins, so those are
 * what a re-check exists to catch. Oldest-due first within each group, so the
 * list rotates instead of returning the same head every time.
 */
export function pickRechecks(due: DueRow[], opts: PickOptions): DueRow[] {
  const failureCap = opts.failureCap ?? 3;
  const seen = new Set<string>();
  const judged: DueRow[] = [];
  const failures: DueRow[] = [];

  const oldestFirst = [...due].sort((a, b) =>
    (a.recheck_after ?? "").localeCompare(b.recheck_after ?? "")
  );

  for (const row of oldestFirst) {
    const d = normDomain(row.domain);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    if (opts.skip.has(d)) continue;
    if (opts.junk?.(d)) continue;
    (isFetchFailure(row.rejection_reason) ? failures : judged).push(row);
  }

  const picks = judged.slice(0, opts.cap);
  const room = Math.max(0, opts.cap - picks.length);
  picks.push(...failures.slice(0, Math.min(failureCap, room)));
  return picks;
}

/**
 * The date a re-read company should next come due.
 *
 * `baseIso` is what recheck-policy.ts says for the NEW verdict. For a judged
 * verdict that stands. For a page that failed to load again, though, the
 * policy's flat 14 days is exactly how a dead domain got re-read every
 * fortnight forever, so a repeat failure backs off instead: the wait is as long
 * as the row has already existed (14 days, then 28, 56, 112, capped at 180).
 * No attempt counter is stored for this; the row's own age is the counter.
 */
export function nextRecheckAfter(args: {
  baseIso: string | null;
  oldReason: string | null;
  newReason: string | null;
  firstSeenAt: string | null;
  now?: Date;
}): string | null {
  const now = args.now ?? new Date();
  if (args.baseIso === null) return null;

  const repeatFailure = isFetchFailure(args.oldReason) && isFetchFailure(args.newReason);
  if (!repeatFailure) return args.baseIso;

  const first = args.firstSeenAt ? new Date(args.firstSeenAt).getTime() : now.getTime();
  const ageDays = Math.max(0, Math.round((now.getTime() - first) / 86_400_000));
  const days = Math.min(180, Math.max(14, ageDays));
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  const backedOff = d.toISOString();
  // Never EARLIER than the policy's own answer.
  return backedOff > args.baseIso ? backedOff : args.baseIso;
}

export type LeadAction =
  | { action: "insert" }
  | { action: "skip" }
  | { action: "supersede"; ids: string[] };

/**
 * ONE LIVE LEAD PER COMPANY.
 *
 * `existing` is every qualified row already on file for this domain in OTHER
 * folders. If there are none, store the new one. If there are, a second row for
 * the same company is a duplicate in every export, so the answer is "skip",
 * with one exception: the new read found a real founder-and-successor pair and
 * the old rows are plain fit-only leads. That is the upgrade a re-check exists
 * to find, so the new row is stored and the old fit-only ones are retired.
 */
export function decideLead(
  existing: { id: string; has_signal: boolean | null }[],
  incoming: { hasSignal: boolean }
): LeadAction {
  if (existing.length === 0) return { action: "insert" };
  const alreadyHasPair = existing.some((e) => e.has_signal === true);
  if (incoming.hasSignal && !alreadyHasPair) {
    return { action: "supersede", ids: existing.map((e) => e.id) };
  }
  return { action: "skip" };
}

/** What a retired fit-only lead says about itself. Rendered on the card. */
export const SUPERSEDED_REASON =
  "Replaced by a newer read of this company that found a founder-and-successor pair. Look for it in your most recent list.";
