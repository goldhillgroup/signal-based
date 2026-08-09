import { createServiceRoleClient } from "../supabase/server";
import { AGREED_STATES, stateNameFor } from "./us-states";
import type { Industry } from "../supabase/types";

/**
 * What to search next, from what actually happened.
 *
 * The search form offered three hardcoded example chips — "Landscaping
 * companies in Texas and Oklahoma, $3-15M" and friends. They were written
 * before anything had ever been searched, they never changed, and after a
 * dozen runs they were suggesting ground already covered.
 *
 * WHAT THIS DELIBERATELY WILL NOT DO IS TELL HIM WHAT IS "HOT".
 *
 * The tempting version ranks states by measured yield: Tennessee is 1 signal
 * in 12 companies read, California is 1 in 83, so recommend Tennessee. That
 * number is real and the conclusion is not — it rests on 2 signals and 1
 * signal respectively, from three searches. At that size the ranking is noise
 * wearing a decimal point, and a recommendation engine that is confidently
 * wrong is worse than none, because it gets believed and then quietly steers
 * every search for months.
 *
 * So suggestions are FACTS, not inferences:
 *   - an agreed state that has never been searched is a fact
 *   - a company due for a free re-check is a fact
 *   - measured yield is shown WITH its sample size, as an observation, and
 *     only once there is enough of it to be worth reading
 *
 * When there is enough data for the ranking to mean something, MIN_READ_FOR_RATE
 * is the one number to change.
 */

/**
 * Companies read before a per-state rate is worth quoting.
 *
 * 40 is roughly where a 1-in-33 base rate stops being a coin flip: below it a
 * single lucky find doubles the apparent rate, and a single unlucky run halves
 * it. Deliberately conservative — the cost of quoting a rate too early is that
 * he plans around a number that will not hold.
 */
const MIN_READ_FOR_RATE = 40;

export interface Suggestion {
  /** Prefilled into the search box when clicked. */
  text: string;
  /** Why this is being suggested, in his terms. */
  why: string;
  kind: "unsearched" | "recheck" | "rate";
}

export async function getSuggestions(limit = 3): Promise<Suggestion[]> {
  const supabase = createServiceRoleClient();
  const out: Suggestion[] = [];

  const { data: rows } = await supabase
    .from("companies")
    .select("state, industry, has_signal, recheck_after");
  const companies = rows ?? [];

  // 1. AGREED GROUND NEVER COVERED. The strongest suggestion there is, because
  //    it needs no statistics: he agreed to these four states and two of them
  //    have never been looked at.
  const searched = new Set(companies.map((c) => c.state).filter(Boolean));
  for (const code of AGREED_STATES) {
    if (searched.has(code)) continue;
    out.push({
      text: `Landscaping companies in ${stateNameFor(code)}`,
      why: "never searched",
      kind: "unsearched",
    });
  }

  // 2. FREE RE-CHECKS COMING DUE. Already-known companies whose recheck date
  //    has passed cost nothing to discover — they are the cheapest signals
  //    available and are invisible unless something says so.
  const now = new Date().toISOString();
  const due = companies.filter((c) => c.recheck_after && c.recheck_after < now);
  if (due.length >= 5) {
    const byState = new Map<string, number>();
    for (const c of due) byState.set(c.state ?? "?", (byState.get(c.state ?? "?") ?? 0) + 1);
    const [top] = [...byState.entries()].sort((a, b) => b[1] - a[1]);
    if (top) {
      out.push({
        text: `Landscaping companies in ${stateNameFor(top[0])}`,
        why: `${top[1]} companies due for a free re-check`,
        kind: "recheck",
      });
    }
  }

  // 3. MEASURED YIELD, with its sample size attached, and only once the sample
  //    is big enough that the rate is worth acting on.
  const byKey = new Map<string, { read: number; sig: number; industry: Industry; state: string }>();
  for (const c of companies) {
    if (!c.state || !c.industry) continue;
    const k = `${c.industry}/${c.state}`;
    const e = byKey.get(k) ?? { read: 0, sig: 0, industry: c.industry as Industry, state: c.state };
    e.read++;
    if (c.has_signal) e.sig++;
    byKey.set(k, e);
  }
  const ranked = [...byKey.values()]
    .filter((v) => v.read >= MIN_READ_FOR_RATE && v.sig > 0)
    .sort((a, b) => b.sig / b.read - a.sig / a.read);
  for (const v of ranked.slice(0, 1)) {
    out.push({
      text: `Landscaping companies in ${stateNameFor(v.state)}`,
      why: `1 signal per ${Math.round(v.read / v.sig)} read, over ${v.read}`,
      kind: "rate",
    });
  }

  return out.slice(0, limit);
}
