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
  /**
   * The rest of his written profile, and NULL EVERYWHERE MEANS "I don't care".
   *
   * These arrived as hardcoded rules read straight off the document he sent —
   * 25-150 employees, 15+ years, no lifestyle businesses. That was the wrong
   * shape for them. Every one is a judgement he is entitled to change, and a
   * threshold buried in a gate is a threshold he cannot see, cannot argue with,
   * and has to ask a developer to move.
   *
   * His own wording is "GENERALLY 25-150 employees" and "USUALLY 15+ years",
   * which is a description of his typical client rather than a specification.
   * Encoding "generally" as a hard filter would refuse companies he would
   * happily take. So: seeded from what he wrote, null-able to switch off
   * entirely, and nothing here rejects on missing information — a page that
   * does not state its headcount is never assumed to be small.
   */
  employeeMin: number | null;
  employeeMax: number | null;
  minYearsInBusiness: number | null;
  /**
   * "They are not lifestyle businesses or solo professional practices." The one
   * criterion he stated as an exclusion rather than a range, so it is a switch
   * rather than a number — and it only ever refuses the unambiguous end, a
   * company the page itself describes as one or two people.
   */
  excludeLifestyleBusinesses: boolean;
  /**
   * "SELECT professional-services firms WITH MULTIPLE FAMILY MEMBERS INVOLVED."
   * The admission criterion for that vertical, in his words. On by default
   * because without it the vertical returns solo architecture studios, which
   * the same sentence excludes — but still his call, because he may decide a
   * single-principal firm is worth a conversation.
   */
  professionalServicesNeedFamily: boolean;
}

/**
 * The description Jonathan gave, phrased as the pipeline needs it: a statement
 * of the SIGNAL, not of the category. "Family-owned landscaping company" would
 * describe the industry filter, which is already a separate control and would
 * waste the queries this generates on companies Maps can list for free.
 *
 * The $3-15M band is the baseline the search form already defaults to,
 * restated here so both agree in one place.
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
  // "Generally 25-150 employees, 3-10 in the office in management roles."
  // Seeded from his document, and every one of these can be cleared to null,
  // which switches the check off rather than setting it to zero.
  employeeMin: 25,
  employeeMax: 150,
  // "Established operating history, usually 15+ years."
  minYearsInBusiness: 15,
  // "They are not lifestyle businesses or solo professional practices."
  excludeLifestyleBusinesses: true,
  // "SELECT professional-services firms WITH MULTIPLE FAMILY MEMBERS INVOLVED."
  professionalServicesNeedFamily: true,
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

  let empMin = num(o.employeeMin);
  let empMax = num(o.employeeMax);
  if (empMin !== null && empMax !== null && empMin > empMax) [empMin, empMax] = [empMax, empMin];

  // A missing boolean means "keep the default", not "off". These arrive from a
  // form that may predate the field, and silently switching off the exclusion
  // his profile states in writing would be the wrong way to be permissive.
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === "boolean" ? v : fallback;

  return {
    signalFocus: focus,
    revenueMinMusd: min,
    revenueMaxMusd: max,
    employeeMin: empMin,
    employeeMax: empMax,
    minYearsInBusiness: num(o.minYearsInBusiness),
    excludeLifestyleBusinesses: bool(
      o.excludeLifestyleBusinesses,
      DEFAULT_ICP.excludeLifestyleBusinesses
    ),
    professionalServicesNeedFamily: bool(
      o.professionalServicesNeedFamily,
      DEFAULT_ICP.professionalServicesNeedFamily
    ),
  };
}
