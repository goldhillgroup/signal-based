import type { SearchMode } from "./supabase/types";

/**
 * The choices a search is made of, defined ONCE.
 *
 * Which trade, which states, what to collect, how big, what size of company.
 * These were once declared separately by each screen that asked, and they had
 * already drifted: one offered a revenue band the other silently ran at "no
 * limit", so the same request produced different results depending on who
 * asked; one called it "Vertical" and the other "Verticals to scan".
 *
 * Sharing the definitions is what stops that happening again: a new mode, a
 * reworded description or a different band shows up everywhere or on
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

/**
 * Which chip matches a stored band — and what to do when none does.
 *
 * The fallback was the LAST option, which is "No limit". So a saved band the
 * chips no longer offer did not merely display oddly: the form initialised to
 * "No limit" and searched with it, silently turning a bounded search into the
 * widest and most expensive one available. It happened for real — the ICP
 * stored in the database still held the old $3-15M, no chip matched it, and
 * the form defaulted to unbounded.
 *
 * Falls back to the FIRST option instead, which is the ICP's sweet spot. If
 * this function has to guess, it should guess narrow: a band that is too tight
 * shows fewer companies and is obvious, while one that is too loose spends
 * more and looks like it worked.
 */
export function bandIndexFor(min: number | null, max: number | null): number {
  const i = BAND_OPTIONS.findIndex((b) => b.min === min && b.max === max);
  return i === -1 ? 0 : i;
}

/**
 * The twelve observable signals from the client's ICP, as things to click,
 * in four groups of three.
 *
 * Twelve pills wrapping across a box is the same mess the settings rows just
 * replaced. They group naturally — who is in the business, how the company
 * describes itself, a handover actually in motion, and pressure that makes
 * the timing right — and three per group lays out as an even grid at every
 * width instead of a ragged wrap.
 *
 * His profile lists them explicitly under "Observable lead-generation
 * signals", with the reasoning that "family conflict and succession concerns
 * are rarely stated publicly, [so] the agency should look for indirect
 * evidence". They were only ever reachable by typing the right phrase into a
 * free-text box, which meant knowing they existed.
 *
 * `phrase` is what actually goes into the Signal focus field, so each one is
 * written as words a company would use ABOUT ITSELF, not as a category name:
 * "recently promoted to president" finds pages, "next_gen_promoted" does not.
 * That field feeds both ends of the pipeline — discovery turns each phrase
 * into a quoted query, and classification takes it as a hint — so the wording
 * has to work as a search, not only as a label.
 */
export const ICP_SIGNAL_GROUPS: {
  heading: string;
  signals: { label: string; phrase: string }[];
}[] = [
  {
    // Who is visibly in the business right now.
    heading: "People",
    signals: [
      { label: "Founder + children", phrase: "founder and his son and daughter in leadership" },
      { label: "Next gen promoted", phrase: "recently promoted to president" },
      { label: "Siblings running it", phrase: "brothers and sisters executive team" },
    ],
  },
  {
    // How the company describes itself.
    heading: "How they talk about themselves",
    signals: [
      { label: "2nd / 3rd generation", phrase: "second generation family owned" },
      { label: "Anniversary story", phrase: "celebrating 50 years family owned" },
      { label: "Legacy language", phrase: "preserving the family legacy" },
    ],
  },
  {
    // A handover actually in motion.
    heading: "Handover in motion",
    signals: [
      { label: "Leadership transition", phrase: "announces leadership transition" },
      { label: "Founder now chairman", phrase: "founder moves to chairman role" },
      { label: "Ownership transfer", phrase: "ownership transfer to the family" },
    ],
  },
  {
    // Pressure on the business, which is what makes the timing right.
    heading: "Outgrowing themselves",
    signals: [
      { label: "Growing fast", phrase: "expansion new facility acquisition" },
      { label: "Professionalising (EOS)", phrase: "implemented EOS advisory board" },
      { label: "Next gen in the news", phrase: "next generation featured interview" },
    ],
  },
];

export const ICP_SIGNALS = ICP_SIGNAL_GROUPS.flatMap((g) => g.signals);

/**
 * How many phrases actually steer DISCOVERY.
 *
 * refinementQueries caps at three so a long paragraph cannot multiply the SERP
 * bill. Everything selected still reaches the classifier as a hint, so nothing
 * is wasted — but the form has to say which is which rather than let someone
 * tick eight and assume all eight are being searched for.
 */
export const FOCUS_PHRASES_THAT_STEER = 3;
