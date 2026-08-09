import type { Company } from "./company";
import { stateNameFor } from "./pipeline/us-states";
import { INDUSTRY_META } from "./signal-meta";

/**
 * Why an accepted company is on the list.
 *
 * A rejected company always carried a reason and a company with a signal always
 * carried a quote — but a company that fit the ICP with no signal had neither.
 * It simply appeared, unexplained, and on a real run that is MOST of the list
 * (one folder was 15 fit-only against 1 signal). "Trust me" is not a good
 * answer from a product whose entire value is judgement he is paying for.
 *
 * Every line below is reconstructed from what the pipeline actually stored and
 * the gates the row had to clear to be saved at all (see the gate chain in
 * orchestrator.ts): wrong trade, outside the requested states, not operating in
 * the US, no longer family-owned, or outside the revenue band would each have
 * made it a rejection instead. So these are facts about this company, not a
 * generic blurb — and where a fact is genuinely unknown it is left out rather
 * than dressed up.
 */

export interface FitExplanation {
  /** One-line summary, safe to show in a list. */
  headline: string;
  /** The specific checks this company passed. */
  points: string[];
  /**
   * Why it is NOT a full signal, when it isn't. This is the sentence he
   * actually wants: it tells him what is missing rather than leaving him to
   * wonder whether the search simply failed.
   */
  missing: string | null;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function explainFit(company: Company): FitExplanation | null {
  // Rejections already state their own reason, and this would contradict it.
  if (company.status !== "qualified") return null;

  const trade = INDUSTRY_META[company.industry]?.label ?? titleCase(company.industry);
  // "-" is the store's placeholder for a null city, and it is TRUTHY — so a
  // plain filter(Boolean) let it through and produced "a landscaping business
  // in -, Tennessee". Same placeholder-printed-as-data bug that made the
  // drawer header read "-, TN · Size not stated". Filter on real content, not
  // on presence.
  const real = (v: string | null | undefined) => (v && v !== "-" ? v : null);
  const where = [real(company.city), real(company.state) ? stateNameFor(company.state) : null]
    .filter(Boolean)
    .join(", ");

  // ORDERED BY HOW MUCH EACH ONE DISTINGUISHES THIS COMPANY.
  //
  // The two universal facts — family-owned, and the right trade in the right
  // state — are true of EVERY accepted row by definition: they are hard gates,
  // so anything that failed them is a rejection and never reaches this list.
  // Leading with them made every row in a table column open with the same
  // sentence. They still belong here, at the end, where they confirm the match
  // without crowding out what actually differs.
  const points: string[] = [];

  if (company.founderName) {
    const who = company.founderTitle
      ? `${company.founderName}, ${company.founderTitle}`
      : company.founderName;
    points.push(`Names a decision-maker on the page: ${who}.`);
  }


  // Size, and what it means when there isn't any.
  //
  // Three quarters of companies publish nothing a revenue estimate can be
  // built from. Saying nothing here let silence stand in for a judgement; the
  // gate used to do the same and cut them as "too small", which is how
  // businesses literally named "Two Generations Landscaping" were thrown out.
  // No figure means no figure. It is not evidence of being small, and it is
  // never grounds for cutting a company, so the panel says that outright.
  const hasFigure =
    company.revenueBand &&
    !/^(unknown|size not stated|-)$/i.test(company.revenueBand.trim());

  if (hasFigure) {
    points.push(`Estimated at ${company.revenueBand}, inside the size range set for this search.`);
  } else {
    points.push(
      "Its site does not say how big it is, so it was not judged on size. A missing figure is not a small company."
    );
  }

  if (company.operatingModel === "own_crews") {
    points.push("Runs its own crews rather than subcontracting the work out.");
  } else if (company.operatingModel === "mixed") {
    points.push("Runs a mix of its own crews and subcontractors.");
  }

  // Both universal, both last — see the ordering note above.
  points.push("Reads as still family-owned on its own site, not acquired or rolled up.");

  // Ordered MOST-DISTINGUISHING FIRST. Every company in a folder shares the
  // trade and the territory — that is what the search asked for — so leading
  // with it makes every row read identically in a table column. The facts that
  // actually differ (size, how it operates, who is named) come first, and the
  // shared context sits at the end where it still confirms the match without
  // crowding out the differences.
  points.push(`A ${trade.toLowerCase()} business${where ? ` in ${where}` : ""}, which is the trade and territory you asked for.`);

  // The signal itself, or its absence. hasSignal is authoritative here — it is
  // what the confidence rating and the whole 'signal' mode key off.
  const hasSignal = company.hasSignal === true;

  let missing: string | null = null;
  if (!hasSignal) {
    missing = company.founderName
      ? "No next generation is named alongside them yet. That is the one thing missing, and it is exactly what changes when a son or daughter steps in, so this company is re-checked automatically."
      : "The site does not name anyone in charge yet, so there is no founder-and-successor pair to confirm. It is re-checked automatically as sites get rebuilt.";
  }

  // THREE states, not two. This read `hasSignal ? "confirmed" : "none yet"`,
  // and hasSignal is true for a 'verify' company as well as a confirmed one —
  // so a lead the pipeline had explicitly flagged as needing a second look was
  // telling him a succession signal "was confirmed". That is the one direction
  // this text must never be wrong in: overstating certainty puts him on a call
  // asserting something about a family that may not be true.
  const headline =
    hasSignal && company.confidence === "verify"
      ? "Fits your criteria. Succession language is on the page, but the pairing is not airtight, so check it before you call."
      : hasSignal
        ? "Fits your criteria, and a succession signal was confirmed."
        : "Fits every criterion you set. No succession signal on the page yet.";

  return { headline, points, missing };
}
