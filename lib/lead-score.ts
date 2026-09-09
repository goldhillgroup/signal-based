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
 * WHAT EACH RUNG MEANS. Fixed text, not a setting.
 *
 * These were editable for a while, one text field per rung in Settings. That
 * was the third version of a card that kept asking him to configure the SCALE,
 * and the scale was never what he wanted to change: "he gives a description,
 * and based on the lead's info, from his description it's a 1 2 3 4 or 5,
 * nothing complex". The description is the setting; these five sentences just
 * say how completely a company matched it, which is arithmetic, not taste.
 *
 * The number is what gets shown and sorted on, and these ride along with it so
 * a 3 is never a digit nobody can decode.
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
  if (grade.quality === "confirmed") return "pairQuoted";
  if (grade.quality === "unconfirmed") return "pairThin";
  return c.founderName || c.nextGenName ? "fitNamed" : "fitUnnamed";
}

export type SignalQuality = "confirmed" | "unconfirmed" | "none";

/**
 * What each grade is CALLED in a sheet Jonathan forwards.
 *
 * These read "good", "meh" and "no signal", which is fine in a code path and
 * wrong in a column somebody else's assistant opens: "meh" is a shrug, not a
 * finding, and it was sitting next to a real company's name. The replacements
 * come from the vocabulary the rest of the app already uses -- signal, fit,
 * outside -- so the sheet and the screen say the same words.
 *
 * "Fit only" rather than "none": the absence is of a NAMED successor on their
 * own website, not of a reason to call. That distinction is Christian's catch
 * and it is carried everywhere else (see SIGNAL_TYPE_META); a column that
 * flattens it back to "none" undoes it in the one artefact that gets sent on.
 */
export const QUALITY_LABEL: Record<SignalQuality, string> = {
  confirmed: "Signal confirmed",
  unconfirmed: "Signal, unconfirmed",
  none: "Fit only, no signal",
};

/** Cut by a gate. Not a grade of signal, but the sheet's column needs a word. */
export const OUTSIDE_LABEL = "Outside ICP";

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
    return { quality: "none", why: "No successor named on their own site" };
  }

  const hasQuote = !!c.evidence?.quote;
  const bothNamed = !!c.founderName && !!c.nextGenName;
  const firm = c.confidence !== "verify";

  if (hasQuote && bothNamed && firm) {
    return {
      quality: "confirmed",
      why: c.evidence?.disproveNotes
        ? "Both named, quoted in their own words, and it survived the disprove pass"
        : "Both named and quoted in their own words",
    };
  }
  if (!hasQuote) return { quality: "unconfirmed", why: "Reads as a handover but nothing is quoted" };
  if (!bothNamed) return { quality: "unconfirmed", why: "Quoted, but only one generation is named" };
  return { quality: "unconfirmed", why: "Quoted, but the wording is not airtight" };
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
/** The score, said in words. */
export function starMeaning(c: Company): string {
  return DEFAULT_RULES[rungFor(c)];
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
