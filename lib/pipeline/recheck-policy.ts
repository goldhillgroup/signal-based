/**
 * When is a previously-seen company worth looking at again?
 *
 * This is what makes a scan next month different from a scan today. The naive
 * options are both wrong:
 *   - never re-check  -> you permanently miss the moment a next-gen joins,
 *                        which is the entire signal this product sells
 *   - always re-check -> every run re-pays for the same companies and returns
 *                        the same list
 *
 * The useful middle: the RIGHT interval depends on WHY it was rejected. Some
 * rejections describe a fact that can change in a quarter; others describe
 * something that will never change.
 */

/** Never re-check. The answer is settled. */
export const NEVER = null;

interface Rule {
  /** Matched against the rejection reason, case-insensitively. */
  test: RegExp;
  /** Days until eligible again, or NEVER. */
  days: number | null;
  why: string;
}

// Ordered — first match wins, so put the permanent/structural cases first.
// Phrasings mirror the actual rejectionReason strings the classifier emits
// (see CLASSIFY_SYSTEM in openrouter.ts) plus the orchestrator's gate messages.
const RULES: Rule[] = [
  {
    // An HVAC company does not become a landscaper. A marketplace does not
    // become a contractor. This is the cheapest possible skip and the safest.
    test: /outside the (landscaping|icp)|not a landscaping|marketplace|directory platform|supplier|brokerage|trade publication|not a single/i,
    days: NEVER,
    why: "wrong industry — structurally permanent",
  },
  {
    // PE roll-ups and acquisitions essentially never revert to family control.
    test: /no longer family-owned|acquired|consolidat|roll-?up/i,
    days: 365,
    why: "acquired/consolidated — very unlikely to revert, but not impossible",
  },
  {
    // Transient infrastructure failure, not a judgment about the company.
    // Worth another go soon — the site may have simply been down.
    // Phrasings after the first three were read off 454 real rejection rows
    // (2026-08-07), not imagined: the classifier describes an unusable page in
    // its own words every time, and those variants were landing on the 90-day
    // default as if a human had judged the company. They hadn't — nothing was
    // ever legible. That's a fetch problem, and fetch problems are worth
    // retrying in two weeks, not one quarter.
    test: /could not be fetched|classification failed|page not found|404|empty placeholder|essentially empty|no content available|placeholder content|only lists services|no about\/team|project blog post/i,
    days: 14,
    why: "fetch/parse failure — transient, retry soon",
  },
  {
    // THE important one. "Only the founder is named", "no next-gen on the
    // leadership page" — this is precisely the fact that changes when a son or
    // daughter steps into the business. Re-checking these on a quarterly
    // cadence is how the engine surfaces NEW signals over time.
    // "no second-generation" (hyphenated) and "Only founder Matt is named"
    // are both real observed phrasings that the un-hyphenated / "only the
    // founder" patterns missed. They landed on the same 90 days by default, so
    // nothing was mis-scheduled — but matching them explicitly means the
    // recheck REASON shown in the UI is right, and a future default change
    // can't silently reclassify them.
    test: /only one generation|no next-gen|no founder-and-next-gen|only the founder|only founder|no second[- ]generation|no generational|cut —/i,
    days: 90,
    why: "no successor visible YET — this is exactly what changes over time",
  },
  {
    // Team page exists but names nobody. Sites get rebuilt and start naming
    // people; slower-moving than the above but far from permanent.
    test: /no mention of any|names no individuals|no named individuals|generic marketing|slogan/i,
    days: 120,
    why: "site names nobody today — may add a team page",
  },
  {
    // Companies grow into (and out of) the band. Slower than leadership
    // changes, but real over a year.
    test: /too small|below the .* bound/i,
    days: 180,
    why: "may grow into the band",
  },
  {
    test: /too big|above the .* bound/i,
    days: 365,
    why: "unlikely to shrink into the band",
  },
];

/** Default when no rule matches — treat like a soft signal rejection. */
const DEFAULT_DAYS = 90;

/**
 * Returns the ISO timestamp when this company should be reconsidered, or null
 * for never.
 *
 * A QUALIFIED company returns null: it is already a lead on his list, and
 * re-classifying it would just spend money to reconfirm something he has
 * already been handed.
 */
export function recheckAfterFor(
  status: "qualified" | "rejected",
  rejectionReason: string | null,
  now = new Date()
): string | null {
  if (status === "qualified") return null;

  const reason = rejectionReason ?? "";
  const rule = RULES.find((r) => r.test.test(reason));
  const days = rule ? rule.days : DEFAULT_DAYS;
  if (days === NEVER) return null;

  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

