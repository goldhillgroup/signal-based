/**
 * WHO THIS PRODUCT IS LOOKING FOR — stated once, in the client's own words,
 * and applied to every search.
 *
 * Jonathan coaches family businesses through succession. His buyer is not
 * "a landscaping company"; it is a company where the founder is STILL running
 * things while a son or daughter steps up beside them. That word "still" is
 * the entire product: a founder who has already retired has no transition left
 * to coach, and a founder with no successor has nothing to hand over.
 *
 * That description used to live only in the classifier's prompt, where nobody
 * but a developer could see or change it. It is now a saved setting with a form
 * on the Settings page, for two reasons:
 *
 *  1. The signal focus STEERS DISCOVERY, not just judgement (see
 *     refinementQueries in apify.ts). Changing this sentence changes which
 *     companies get searched for — it is the highest-leverage control in the
 *     product, and it belonged in the client's hands.
 *  2. His definition of a good lead will move as he works the list. When it
 *     does, he can say so himself rather than waiting on a code change.
 *
 * CLIENT-SAFE. This module is imported by a Client Component and must never
 * reach lib/supabase/server — that pulls `next/headers` and `node:async_hooks`
 * into the browser bundle and fails the build. Reads and writes live in
 * ./icp.ts, which is server-only. Same split as schedule-types.ts / schedule.ts,
 * for the same reason.
 */

export interface Icp {
  /**
   * The signal, in Jonathan's words. Becomes the default Signal focus on every
   * search and — since the discovery fix — is turned into quoted search queries
   * anchored to the trade. Blank means "use the proven phrasing sets only",
   * which is exactly how the product behaved before this existed.
   */
  signalFocus: string;
  /** Revenue band in $M. Either end may be null for "no limit". */
  revenueMinMusd: number | null;
  revenueMaxMusd: number | null;
}

/**
 * The description Jonathan gave, phrased as the pipeline needs it: a statement
 * of the SIGNAL, not of the category. "Family-owned landscaping company" would
 * describe the industry filter, which is already a separate control and would
 * waste the queries this generates on companies Maps can list for free.
 *
 * The $3-15M band is the baseline both the one-off form and the scheduled
 * harvest already default to, restated here so all three agree in one place.
 */
export const DEFAULT_ICP: Icp = {
  signalFocus: "founder still leading with a son or daughter stepping up beside them",
  // $5M-$30M, from the client's written ICP. It was $3M-$15M, which was the
  // brief this was built against; the ceiling in particular was cutting real
  // leads — seven companies were rejected as "too big" that sit inside $30M.
  // His stated sweet spot is $5M-$15M, which the classifier is told separately
  // so it can prefer the middle without rejecting the edges.
  revenueMinMusd: 5,
  revenueMaxMusd: 30,
};

/** Clamp anything read from storage or posted by a form into a usable Icp. */
export function normalizeIcp(raw: unknown): Icp {
  const o = (raw ?? {}) as Partial<Record<keyof Icp, unknown>>;
  const num = (v: unknown): number | null => {
    if (v === null || v === "" || v === undefined) return null;
    const n = Number(v);
    // Negative or absurd revenue is a typo, not an intention. Falling back to
    // null ("no limit") rather than to the default keeps a deliberate "no
    // ceiling" working while refusing to store nonsense.
    return Number.isFinite(n) && n >= 0 && n <= 100_000 ? n : null;
  };
  const focus = typeof o.signalFocus === "string" ? o.signalFocus.trim().slice(0, 300) : "";
  let min = num(o.revenueMinMusd);
  let max = num(o.revenueMaxMusd);
  // A band entered backwards would silently match nothing.
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return { signalFocus: focus, revenueMinMusd: min, revenueMaxMusd: max };
}
