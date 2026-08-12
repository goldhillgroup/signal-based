import type { SearchMode } from "./supabase/types";

/**
 * The choices a search is made of, defined ONCE.
 *
 * A one-off search and the weekly harvest are the same decision made at two
 * different times: which trade, which states, what to collect, how big, what
 * size of company. They were built as two separate screens that each declared
 * their own options, and they had already drifted:
 *
 *   - the search form offered a revenue band; the harvest silently ran every
 *     scan at "no limit", so the same request produced different results
 *     depending on which screen asked for it
 *   - the harvest's mode control was three descriptive cards while the form's
 *     was three plain buttons with a caption
 *   - "Vertical" on one, "Verticals to scan" on the other; "Companies to find"
 *     against "Leads per folder"
 *
 * Sharing the definitions is what stops that happening again: a new mode, a
 * reworded description or a different band shows up on both screens or on
 * neither.
 */

export const MODE_META: Record<
  SearchMode,
  { label: string; description: string; targetLabel: string }
> = {
  hybrid: {
    label: "Hybrid",
    description:
      "Every company that fits, succession signals ranked first, everyone else right behind.",
    targetLabel: "Companies to find:",
  },
  signal: {
    label: "Signal only",
    description: "Only companies showing a real founder-to-next-gen succession signal.",
    targetLabel: "Signals to find:",
  },
  filter: {
    label: "Just filter",
    description:
      "Every company in the vertical + state that fits the ICP, no signal required at all.",
    targetLabel: "Companies to find:",
  },
};

export const MODE_ORDER: SearchMode[] = ["hybrid", "signal", "filter"];

/**
 * The client's written ICP names $5M-$30M, with $5M-$15M as the sweet spot.
 *
 * These were $3-15M, from the earlier brief, and the chips are what a person
 * actually clicks — so the form was still offering the old profile after the
 * default and the classifier had both moved. Seven companies had already been
 * cut as "too big" that sit inside the new ceiling.
 *
 * Both bands he names are offered, sweet spot first because it is where he
 * says most of his clients are. Kept as DEFAULTS rather than hard rules —
 * "no limit" is one click away, and the estimate comes from soft textual
 * proxies (crew size, years in business) rather than real financials, so it
 * should never feel like a locked constraint.
 */
export const BAND_OPTIONS: { label: string; min: number | null; max: number | null }[] = [
  { label: "$5-15M (sweet spot)", min: 5, max: 15 },
  { label: "$5-30M (full ICP)", min: 5, max: 30 },
  { label: "Under $5M", min: null, max: 5 },
  { label: "$30M+", min: 30, max: null },
  { label: "No limit", min: null, max: null },
];

export function bandIndexFor(min: number | null, max: number | null): number {
  const i = BAND_OPTIONS.findIndex((b) => b.min === min && b.max === max);
  return i === -1 ? BAND_OPTIONS.length - 1 : i;
}

/**
 * Suggested signal-focus phrasings, shared by the one-off search and the
 * weekly harvest. Same decision, same suggestions — they were only on the
 * search form, which is how the harvest ended up with no way to express it
 * at all.
 */
export const REFINEMENT_EXAMPLES = [
  "succession signals",
  "founder retiring",
  "second generation taking over",
];
