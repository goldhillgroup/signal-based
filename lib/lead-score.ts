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
export interface ScoreRules {
  /** Both generations named, quoted in their own words, wording firm. */
  pairQuoted: number;
  /** A pair, but no quote or the wording is arguable. */
  pairThin: number;
  /** Fits the ICP, no successor, but somebody is named. */
  fitNamed: number;
  /** Fits the ICP, and nobody is named on the site. */
  fitUnnamed: number;
  /** Cut by one of the gates. */
  outside: number;
}

export const DEFAULT_RULES: ScoreRules = {
  pairQuoted: 5,
  pairThin: 4,
  fitNamed: 3,
  fitUnnamed: 2,
  outside: 1,
};

/** Shown in Settings, so each row says which lead it is talking about. */
export const RULE_LABELS: { key: keyof ScoreRules; label: string; hint: string }[] = [
  { key: "pairQuoted", label: "Founder and successor, quoted", hint: "Both named, in their own words, wording firm. The thing you are looking for." },
  { key: "pairThin", label: "A pair, but thin evidence", hint: "Reads as a handover with nothing quoted, or wording the classifier was unsure about." },
  { key: "fitNamed", label: "Fits, somebody named", hint: "Right trade and area, family-run, no successor, but there is a person to ask for." },
  { key: "fitUnnamed", label: "Fits, nobody named", hint: "Right trade and area, and the site names nobody at all." },
  { key: "outside", label: "Outside the ICP", hint: "Cut by one of your gates." },
];

/** Anything missing or out of range falls back rather than scoring as zero. */
export function parseRules(raw: unknown): ScoreRules {
  if (!raw || typeof raw !== "object") return DEFAULT_RULES;
  const out = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES) as (keyof ScoreRules)[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 5) out[k] = Math.round(v);
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

/** The score. 1 to 5, off the qualification the pipeline already applies. */
export function starsFor(c: Company, rules: ScoreRules = DEFAULT_RULES): number {
  if (c.status !== "qualified") return rules.outside;
  const grade = gradeSignal(c);
  if (grade.quality === "good") return rules.pairQuoted;
  if (grade.quality === "meh") return rules.pairThin;
  return c.founderName || c.nextGenName ? rules.fitNamed : rules.fitUnnamed;
}

/**
 * What the number means, given the rules in force.
 *
 * Derived rather than a fixed map: once two situations can share a number --
 * which they can, if he decides a thin pair and a named fit are both a 3 --
 * a lookup keyed on the score alone would name only one of them.
 */
export function starMeaning(c: Company, rules: ScoreRules = DEFAULT_RULES): string {
  if (c.status !== "qualified") return "Outside the ICP";
  const grade = gradeSignal(c);
  if (grade.quality === "good") return "Pair, quoted";
  if (grade.quality === "meh") return "Pair, thin evidence";
  void rules;
  return c.founderName || c.nextGenName ? "Fits, someone named" : "Fits, nobody named";
}

/** The same thing in words, for a column heading somebody has to read. */
export const STAR_LABEL: Record<number, string> = {
  5: "Pair, quoted",
  4: "Pair, thin evidence",
  3: "Fits, someone named",
  2: "Fits, nobody named",
  1: "Outside the ICP",
};

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
