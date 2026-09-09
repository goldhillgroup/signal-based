import type { Company } from "./company";
import { personalEmail } from "./company";

/**
 * How good a lead is, on Jonathan's own qualification.
 *
 * DELIBERATELY SMALL. This was briefly a 0-100 built from twelve weights, each
 * settable, with a factor list and bands derived from thresholds. That is
 * machinery around a judgement rather than the judgement, and Daniel was right
 * to call it: "just score based on his qualification, what is good or bad
 * lead". The qualification is already written down -- the right trade, the
 * right territory, family-owned, a founder still leading with the next
 * generation stepping up -- and the pipeline already sorts every company
 * against it. The score is that sorting, said as a number.
 *
 *   5  a pair, quoted in their own words, wording firm
 *   4  a pair, but the evidence is thin: no quote, or arguable wording
 *   3  fits the ICP, no successor named, somebody to ask for
 *   2  fits the ICP, but nobody is named on the site
 *   1  outside the ICP: cut by one of the gates
 *
 * Measured across 448 real leads: 28 fives, 36 fours, 209 threes, 175 twos.
 *
 * WHAT IT IGNORES, on purpose: whether an address has been bought. That is a
 * step nobody has run yet, not a fact about the company, and folding it in was
 * what made an earlier score read as "most of your list is rubbish". It is
 * answered separately by `nextStep`.
 */

/**
 * What each rung is worth.
 *
 * ADJUSTABLE, but only five numbers. An earlier version made twelve separate
 * weights settable and that was machinery around the judgement rather than the
 * judgement -- rightly cut. What is worth setting is not how many points a
 * phone number earns; it is whether a pair with no quote is a 4 or a 3, which
 * is a real disagreement somebody can have with the scoring.
 *
 * The RULES are fixed, because they are his qualification and the pipeline
 * already sorts against them. Only the number each situation lands on moves.
 */
/**
 * WORDS, NOT DIGITS. "1 to 5" describes how many rungs there are, not what a
 * lead should be labelled. A 3 beside a company name says nothing on its own
 * and has to be decoded against a legend somebody has to remember; the
 * sentence says it outright. The numbers survive only as sort order, and are
 * never shown.
 *
 * Editable, because these are descriptions of HIS leads. The one the pipeline
 * cannot express is not a wording problem, so the five situations are fixed --
 * only how each is described moves.
 */
export interface ScoreRules {
  /** Both generations named, quoted in their own words, wording firm. */
  pairQuoted: string;
  /** A pair, but no quote or the wording is arguable. */
  pairThin: string;
  /** Fits the ICP, no successor, but somebody is named. */
  fitNamed: string;
  /** Fits the ICP, and nobody is named on the site. */
  fitUnnamed: string;
  /** Cut by one of the gates. */
  outside: string;
}

export const DEFAULT_RULES: ScoreRules = {
  pairQuoted: "Matches what you asked for, quoted",
  pairThin: "Matches, evidence is thin",
  fitNamed: "Right kind of company, no match",
  fitUnnamed: "Right kind of company, nobody named",
  outside: "Outside the ICP",
};

/** Best first. Used for sorting and for the order the choices appear in. */
export const RUNG_ORDER: (keyof ScoreRules)[] = [
  "pairQuoted",
  "pairThin",
  "fitNamed",
  "fitUnnamed",
  "outside",
];

/** Which rung a lead sits on. Internal: this is sort order, never a label. */
export function rungFor(c: Company): keyof ScoreRules {
  if (c.status !== "qualified") return "outside";
  const grade = gradeSignal(c);
  if (grade.quality === "good") return "pairQuoted";
  if (grade.quality === "meh") return "pairThin";
  return c.founderName || c.nextGenName ? "fitNamed" : "fitUnnamed";
}

/** Shown in Settings, so each row says which lead it is talking about. */
/** What each situation IS, so Settings can say which lead is being described. */
export const RULE_LABELS: { key: keyof ScoreRules; hint: string }[] = [
  { key: "pairQuoted", hint: "The page shows what your sentence describes, in their own words, and the wording is firm." },
  { key: "pairThin", hint: "The page reads that way with nothing quoted, or wording the classifier was not sure about." },
  { key: "fitNamed", hint: "Right trade and area, family-run, but the page does not show what your sentence describes. Somebody is named." },
  { key: "fitUnnamed", hint: "Right trade and area, and the site names nobody at all." },
  { key: "outside", hint: "Cut by one of your gates." },
];

/** Anything missing or out of range falls back rather than scoring as zero. */
export function parseRules(raw: unknown): ScoreRules {
  if (!raw || typeof raw !== "object") return DEFAULT_RULES;
  const out = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES) as (keyof ScoreRules)[]) {
    const v = (raw as Record<string, unknown>)[k];
    // A blank wording falls back rather than labelling a lead with nothing.
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 80);
  }
  return out;
}

export type SignalQuality = "good" | "meh" | "no signal";

export interface SignalGrade {
  quality: SignalQuality;
  /** The one-line reason, so the grade can be argued with rather than trusted. */
  why: string;
}

export function gradeSignal(c: Company): SignalGrade {
  if (c.hasSignal !== true) {
    // NOT "not good". A fit-only company is a real business in the right trade
    // that simply does not print a successor -- 86% of the database, and
    // calling that bad would be calling most of his list bad. It is an absence
    // of evidence, and the words should say so.
    return { quality: "no signal", why: "No successor named on their own site" };
  }

  const hasQuote = !!c.evidence?.quote;
  const bothNamed = !!c.founderName && !!c.nextGenName;
  const firm = c.confidence !== "verify";

  if (hasQuote && bothNamed && firm) {
    return {
      quality: "good",
      why: c.evidence?.disproveNotes
        ? "Both named, quoted in their own words, and it survived the disprove pass"
        : "Both named and quoted in their own words",
    };
  }
  if (!hasQuote) return { quality: "meh", why: "Reads as a handover but nothing is quoted" };
  if (!bothNamed) return { quality: "meh", why: "Quoted, but only one generation is named" };
  return { quality: "meh", why: "Quoted, but the wording is not airtight" };
}

/**
 * Sort order only, best first. Never rendered.
 *
 * Kept because a hundred leads still have to be put in an order, and "which
 * of five rungs" is exactly that. It is the LABEL that had to stop being a
 * digit, not the ranking underneath.
 */
export function rankFor(c: Company): number {
  return RUNG_ORDER.length - RUNG_ORDER.indexOf(rungFor(c));
}

/**
 * What the number means, given the rules in force.
 *
 * Derived rather than a fixed map: once two situations can share a number --
 * which they can, if he decides a thin pair and a named fit are both a 3 --
 * a lookup keyed on the score alone would name only one of them.
 */
/** The score, as the sentence he wrote for that situation. */
export function starMeaning(c: Company, rules: ScoreRules = DEFAULT_RULES): string {
  return rules[rungFor(c)];
}

/** The same thing in words, for a column heading somebody has to read. */


/**
 * What the lead NEEDS, which is a different question from how good it is.
 *
 * Kept separate for the reason above: a company is not worse because nobody
 * has pressed Find emails on it yet.
 */
export function nextStep(c: Company): "ready to call" | "needs an email" | "no signal yet" {
  if (c.status !== "qualified") return "no signal yet";
  if (c.hasSignal !== true) return "no signal yet";
  return personalEmail(c)?.email ? "ready to call" : "needs an email";
}
