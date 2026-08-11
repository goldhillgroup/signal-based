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

/**
 * WHO a rejection applies to, which is a separate question from WHEN it expires.
 *
 * The two were conflated, and it was silently costing real leads. A rejection
 * was treated as a fact about the company, so it suppressed that domain in
 * EVERY future search. But half of them are not facts about the company at all
 * — they are facts about the company *relative to the search that judged it*:
 *
 *   "outside the landscaping ICP"  is only true if you are looking for landscapers
 *   "too small, below the bound"   is only true against THAT search's revenue band
 *
 * Jonathan runs different searches. A firm cut from a landscaping run for being
 * an HVAC company is the single best possible candidate for an HVAC run, and
 * was being blacklisted from it for 18 months. Measured against live data on
 * 2026-08-09: 38 of 77 rejections (49%) carried a verdict that only its own
 * search was entitled to make.
 *
 *   global   - true no matter who asks. Not a real company; site names nobody;
 *              no successor visible; acquired. Keep suppressing everywhere.
 *   industry - a verdict about the TRADE. Only binds searches for that vertical.
 *   size     - a verdict about REVENUE. Only binds searches whose band still
 *              excludes the company's own estimate.
 */
export type RejectionScope = "global" | "industry" | "size";

interface Rule {
  /** Matched against the rejection reason, case-insensitively. */
  test: RegExp;
  /** Days until eligible again, or NEVER. */
  days: number | null;
  /** Which future searches this verdict is entitled to bind. */
  scope: RejectionScope;
  why: string;
}

// Ordered — first match wins, so put the permanent/structural cases first.
// Phrasings mirror the actual rejectionReason strings the classifier emits
// (see CLASSIFY_SYSTEM in openrouter.ts) plus the orchestrator's gate messages.
const RULES: Rule[] = [
  {
    // Structurally never a family-owned trade business, however long you wait.
    // A marketplace does not grow crews; a magazine does not start installing
    // irrigation. These are the only genuinely permanent rejections.
    test: /marketplace|directory platform|lead-?gen|brokerage|trade publication|magazine|not an? (actual|real) (company|business)|not a single/i,
    days: NEVER,
    scope: "global",
    why: "not a trade business at all, structurally permanent",
  },
  {
    // Wrong TRADE, which is a different claim from "not a business". This used
    // to sit in the rule above under "an HVAC company does not become a
    // landscaper" — true on any given day, and wrong over years. Trades
    // diversify: roofers add gutters and outdoor living, HVAC firms add
    // irrigation, a materials supplier starts installing what it sells. The
    // ICP is also an umbrella (tree service and hardscaping both count), so
    // a company sitting just outside it can drift inside without changing
    // what it calls itself.
    //
    // 18 months is deliberately long — this is not a fact that moves in a
    // quarter — but it is not "never". The whole cost of being wrong here is
    // one fetch and one classify (~$0.018) per company per 18 months; for the
    // 78 rows currently marked permanent that is about $1.40 every year and a
    // half. Cheap insurance against silently blacklisting a company that grew
    // into the ICP.
    test: /outside the (landscaping|icp)|not a landscaping|wrong industry|supplier|hvac|roofing|plumbing/i,
    days: 545,
    scope: "industry",
    why: "wrong trade today, trades diversify, so worth one look in 18 months",
  },
  {
    // PE roll-ups and acquisitions essentially never revert to family control.
    test: /no longer family-owned|acquired|consolidat|roll-?up/i,
    days: 365,
    scope: "global",
    why: "acquired/consolidated, very unlikely to revert, but not impossible",
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
    scope: "global",
    why: "fetch or parse failure, worth another try soon",
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
    test: /only one generation|no next-gen|no founder-and-next-gen|only the founder|only founder|no second[- ]generation|no generational|cut -/i,
    days: 90,
    scope: "global",
    why: "no successor visible YET, this is exactly what changes over time",
  },
  {
    // Team page exists but names nobody. Sites get rebuilt and start naming
    // people; slower-moving than the above but far from permanent.
    test: /no mention of any|names no individuals|no named individuals|generic marketing|slogan/i,
    days: 120,
    scope: "global",
    why: "site names nobody today, may add a team page",
  },
  {
    // Companies grow into (and out of) the band. Slower than leadership
    // changes, but real over a year.
    test: /too small|below the .* bound/i,
    days: 180,
    scope: "size",
    why: "may grow into the band",
  },
  {
    test: /too big|above the .* bound/i,
    days: 365,
    scope: "size",
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

/**
 * Which future searches this rejection is entitled to suppress.
 *
 * Same rule table, same first-match-wins order as recheckAfterFor, so the two
 * answers can never drift apart. An unmatched reason falls back to "global",
 * which is the conservative direction: it costs a re-scan we might have
 * skipped, never a lead we should have seen.
 */
/**
 * Is this simply a DIFFERENT KIND OF BUSINESS, rather than a company that
 * failed one of Jonathan's gates?
 *
 * A separate question from when to re-crawl it, which is what the rules above
 * decide. This one is about what to put in front of a person.
 *
 * The "Not a fit" tab exists so a cut can be argued with — Jonathan sees the
 * reason and enriches it anyway if he disagrees. That is a real and useful
 * thing for "no longer family-owned", "too big", "only one generation named":
 * right kind of company, failed a test, reasonable people could differ.
 *
 * It is not a useful thing for a funeral home. A live run cut 37 companies and
 * 24 of them were an obituary site, a high school reunion page, a political
 * campaign, a newspaper sports report, an appliance retailer, an advertising
 * agency, a permit expediter, an architecture firm and eight funeral homes.
 * None is a judgement he would want to revisit; they are search noise, and
 * putting them in the same list as the arguable cuts buries the arguable ones.
 *
 * So these are hidden by default and counted, never deleted — they remain
 * cross-search memory, and the count is shown so nothing is silently dropped.
 */
// Stems are deliberately NOT closed with \b. A first version wrote
// `\bobituar\b`, which cannot match "obituary" — the boundary fails against
// the following "y" — so eight obituary sites, a Q&A platform and a 404 page on
// Legacy.com all sat in the arguable-cuts list. Open the stem, anchor only the
// front.
const WRONG_KIND_RE = new RegExp(
  [
    "funeral", "cremat", "obituar", "cemeter", "memorial (home|park|garden)",
    "newspaper", "news(paper)?[ /]?(media|outlet|site|article)", "media (company|outlet|brand|platform|/events)",
    "magazine", "publishing", "publication", "journalis",
    "political campaign", "candidate", "reunion", "q&a platform",
    "nonprofit", "non-profit", "trade association", "membership organi",
    "brokerage", "real estate", "architect", "advertising", "marketing agency",
    "law firm", "attorney", "software", "saas", "e-?commerce", "retailer", "dealer",
    "marketplace", "directory", "lead-?gen", "permit (expedit|consult)",
    "insurance", "staffing", "recruit",
  ].map((w) => `\\b${w}`).join("|"),
  "i"
);

export function isWrongKindOfBusiness(rejectionReason: string | null | undefined): boolean {
  if (!rejectionReason) return false;
  // "No longer family-owned", "too big", "only one generation" and a failed
  // fetch are all the RIGHT kind of company — never hide those, whatever else
  // the sentence happens to mention.
  if (/no longer family-owned|acquired|consolidat|roll-?up|too big|too small|above the|below the|upper bound|lower bound|only one (individual|generation)|no mention of any leadership|could not be fetched|too thin|could not be judged/i.test(rejectionReason)) {
    return false;
  }
  return WRONG_KIND_RE.test(rejectionReason);
}

export function rejectionScope(rejectionReason: string | null): RejectionScope {
  const rule = RULES.find((r) => r.test.test(rejectionReason ?? ""));
  return rule ? rule.scope : "global";
}

/**
 * Parse the classifier's revenue estimate into millions [lo, hi].
 *
 * These are strings it writes itself, in a handful of shapes observed live:
 * "$1-3M (est.)", "under $1M (est.)", "$15M+ (est.)". Anything unparseable
 * returns null and the caller treats size as unknown.
 */
export function parseRevenueBand(band: string | null): { lo: number; hi: number } | null {
  if (!band) return null;
  const s = band.toLowerCase();
  const under = s.match(/under\s*\$?([\d.]+)\s*m/);
  if (under) return { lo: 0, hi: parseFloat(under[1]) };
  const range = s.match(/\$?([\d.]+)\s*-\s*\$?([\d.]+)\s*m/);
  if (range) return { lo: parseFloat(range[1]), hi: parseFloat(range[2]) };
  const plus = s.match(/\$?([\d.]+)\s*m\s*\+/);
  if (plus) return { lo: parseFloat(plus[1]), hi: Infinity };
  const single = s.match(/\$?([\d.]+)\s*m/);
  if (single) return { lo: parseFloat(single[1]), hi: parseFloat(single[1]) };
  return null;
}

/**
 * Would THIS search's revenue band still reject a company the classifier sized
 * at `band`? Only then does an old size-based rejection still bind.
 *
 * Unknown size (unparseable, or no estimate recorded) returns false — do not
 * suppress. That mirrors the soft-gate policy in the orchestrator, which
 * refuses to cut a company on an absent size read, and keeps the two from
 * disagreeing about the same company.
 */
export function sizeVerdictStillBinds(
  companyBand: string | null,
  search: { min: number | null; max: number | null } | undefined
): boolean {
  const est = parseRevenueBand(companyBand);
  if (!est) return false;
  const min = search?.min ?? null;
  const max = search?.max ?? null;
  if (min === null && max === null) return false; // unbounded search rejects nobody on size
  if (min !== null && est.hi < min) return true; // still too small
  if (max !== null && est.lo > max) return true; // still too big
  return false; // overlaps the band now, so the old verdict does not apply
}

