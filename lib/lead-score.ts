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
export function starsFor(c: Company): 1 | 2 | 3 | 4 | 5 {
  if (c.status !== "qualified") return 1;
  const grade = gradeSignal(c);
  if (grade.quality === "good") return 5;
  if (grade.quality === "meh") return 4;
  return c.founderName || c.nextGenName ? 3 : 2;
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
