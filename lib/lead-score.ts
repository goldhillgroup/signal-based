import type { Company } from "./company";
import { personalEmail, generalEmail } from "./company";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "./score-weights";

/**
 * How strong a lead is, and why.
 *
 * WHY IT SHOWS ITS WORKING. The whole argument of this product is that every
 * row can be checked: a quote, a live URL, a reason for every rejection. A
 * score that arrived as a bare number would be the one thing on the page that
 * has to be taken on trust, which is exactly what the rest of it refuses to
 * ask for. So the score is a list of reasons that happens to add up, and the
 * reasons are what is shown.
 *
 * WHAT IT IS FOR. Sorting a hundred leads by which to call first. Not deciding
 * whether a lead is real -- the gates already did that, and anything scoring
 * low is still a company that passed them.
 *
 * WHAT IS DELIBERATELY NOT IN IT:
 *
 *   Company size. 75% of leads have no revenue figure at all, because most
 *   sites do not print one. Scoring on it would rank by how talkative a
 *   website is, and would push exactly the small owner-led businesses this
 *   ICP is about to the bottom.
 *
 *   Discovery channel. Web search finds more pairs than Maps, which is a fact
 *   about the CHANNEL and says nothing about the company it found. Ranking a
 *   lead lower because of where it was noticed would be superstition.
 *
 *   Recency. first_seen_at is when the crawler read the page, not when
 *   anything happened at the company.
 */

export interface ScoreFactor {
  /** Shown to the reader, so it has to be a sentence about the COMPANY. */
  label: string;
  points: number;
}

export interface LeadScore {
  /** 0-100. */
  score: number;
  /**
   * WHAT TO DO WITH IT, not how good it is.
   *
   * The bands were "strong / worth a look / thin" until this was measured
   * against the real database: median 15 out of 100, and 85% of 448 leads
   * landed in "thin". Shipping that tells Jonathan most of what he paid for is
   * rubbish, which is both demoralising and untrue -- the score is dominated
   * by whether an ADDRESS has been bought, and that is a step nobody has run
   * yet rather than a fact about the company.
   *
   * The same finding sank an earlier 1-10 score, recorded in tests/lead.test
   * .mts: "30 of 33 leads scored 4 or below, so printing it told the client his
   * own leads were failures". Twice is a pattern. The number still sorts; the
   * words now name the next action.
   */
  band: "ready to call" | "needs an email" | "no signal yet";
  factors: ScoreFactor[];
  /** Why it is not higher, which is the more useful half on a low score. */
  missing: string[];
}

/**
 * The band is decided by WHAT IS MISSING, not by the total.
 *
 * A threshold on the number reproduces the problem it exists to avoid: a
 * perfectly good fit-only lead with no address scores 35 and would be labelled
 * whatever 35 gets called. What the reader needs is the next step.
 */
function bandFor(c: Company, hasPersonalEmail: boolean): LeadScore["band"] {
  if (c.hasSignal !== true) return "no signal yet";
  return hasPersonalEmail ? "ready to call" : "needs an email";
}

export function scoreLead(c: Company, w: ScoreWeights = DEFAULT_WEIGHTS): LeadScore {
  // A WEIGHT OF ZERO MEANS "I DO NOT COUNT THIS", so the factor is left out of
  // the reasons entirely. Listing "Phone number on file  0" is noise dressed
  // up as a reason, and the reasons are the only thing that makes the score
  // arguable.
  const factors: ScoreFactor[] = [];
  const missing: string[] = [];

  // EVERY KEPT LEAD STARTS ABOVE ZERO. It was read, judged against the trade,
  // the territory, the size band and the family-owned test, and it survived
  // all of them. Scoring that at nothing was the harshness: a good fit with no
  // address came out at 15 out of 100, which reads as a verdict on the company
  // when it means nobody has pressed Find emails.
  if (w.base > 0) factors.push({ label: "Passed every gate you set", points: w.base });

  // THE SIGNAL, worth more than everything else combined. A confirmed
  // founder-and-successor pair is the product; the rest is how easy that lead
  // is to act on.
  if (c.hasSignal === true && c.confidence !== "verify") {
    factors.push({ label: "Both generations named and running it today", points: w.signalFirm });
  } else if (c.hasSignal === true) {
    factors.push({ label: "Reads as a handover, wording not airtight", points: w.signalVerify });
  } else {
    missing.push("No succession signal on the page");
  }

  // The evidence. A pair with no quote cannot be checked, and this product's
  // claim is that it can be.
  if (c.evidence?.quote) {
    factors.push({ label: "Carries a verbatim quote you can check", points: w.quote });
  } else {
    missing.push("No quote on file");
  }
  if (c.evidence?.disproveNotes && w.disproved > 0) {
    factors.push({ label: "Survived the disprove pass", points: w.disproved });
  }

  // Who to call.
  if (c.founderName && c.nextGenName) {
    factors.push({ label: "Both people named", points: w.bothNamed });
  } else if (c.founderName || c.nextGenName) {
    factors.push({ label: "One person named", points: w.oneNamed });
    missing.push("Only one generation named");
  } else {
    missing.push("Nobody named on the site");
  }

  // How to reach them. A personal address is the difference between a lead and
  // a company you know about.
  const personal = personalEmail(c);
  if (personal?.verificationStatus === "valid") {
    factors.push({ label: "Personal address, confirmed deliverable", points: w.emailValid });
  } else if (personal?.email) {
    factors.push({ label: "Personal address, not yet confirmed", points: w.emailUnverified });
  } else if (generalEmail(c)?.email) {
    factors.push({ label: "Office inbox only", points: w.emailGeneral });
    missing.push("No personal address yet");
  } else {
    missing.push("No email address at all");
  }

  if (c.phone && w.phone > 0) factors.push({ label: "Phone number on file", points: w.phone });

  // Location, because he works territories and a lead he cannot place is a
  // lead he cannot plan a week around.
  if (c.state && c.state !== "-" && c.city && c.city !== "-" && w.location > 0) {
    factors.push({ label: "Town and state known", points: w.location });
  } else if (!c.state || c.state === "-") {
    missing.push("No location");
  }

  const raw = factors.reduce((n, f) => n + f.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, band: bandFor(c, !!personal?.email), factors, missing };
}

/**
 * How good the SIGNAL is, which is a different question from what to do next.
 *
 * "Good, meh, not good, you know?" -- and he is right that those are different
 * axes. `band` says what the lead NEEDS (an email, a signal, or nothing, call
 * it). This says how much weight the succession evidence itself carries, which
 * is the thing the whole product turns on and the thing a reader is entitled
 * to disagree with.
 *
 * Only three grades, because that is as fine as the evidence honestly divides.
 * A fourth would be pretending to a precision the underlying judgement does not
 * have.
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
  const disproved = !!c.evidence?.disproveNotes;

  if (hasQuote && bothNamed && firm) {
    return {
      quality: "good",
      why: disproved
        ? "Both named, quoted in their own words, and it survived the disprove pass"
        : "Both named and quoted in their own words",
    };
  }

  if (!hasQuote) return { quality: "meh", why: "Reads as a handover but nothing is quoted" };
  if (!bothNamed) return { quality: "meh", why: "Quoted, but only one generation is named" };
  return { quality: "meh", why: "Quoted, but the wording is not airtight" };
}

/** A cut company has no score: it is not a lead, and ranking it would imply otherwise. */
export function scoreOf(c: Company, w?: ScoreWeights): number | null {
  return c.status === "qualified" ? scoreLead(c, w).score : null;
}
