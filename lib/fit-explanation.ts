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
  const where = [company.city, company.state ? stateNameFor(company.state) : null]
    .filter(Boolean)
    .join(", ");

  const points: string[] = [];

  points.push(`A ${trade.toLowerCase()} business${where ? ` in ${where}` : ""}, which is the trade and territory you asked for.`);

  // Family ownership is a hard gate — a company the classifier read as acquired
  // or consolidated is rejected, so surviving to here means the page still
  // reads as family-held.
  points.push("Reads as still family-owned on its own site, not acquired or rolled up.");

  if (company.revenueBand && company.revenueBand.toLowerCase() !== "unknown") {
    points.push(`Estimated at ${company.revenueBand}, inside the size range set for this search.`);
  }

  if (company.operatingModel === "own_crews") {
    points.push("Runs its own crews rather than subcontracting the work out.");
  } else if (company.operatingModel === "mixed") {
    points.push("Runs a mix of its own crews and subcontractors.");
  }

  if (company.founderName) {
    const who = company.founderTitle
      ? `${company.founderName}, ${company.founderTitle}`
      : company.founderName;
    points.push(`Names a decision-maker on the page: ${who}.`);
  }

  // The signal itself, or its absence. hasSignal is authoritative here — it is
  // what the confidence rating and the whole 'signal' mode key off.
  const hasSignal = company.hasSignal === true;

  let missing: string | null = null;
  if (!hasSignal) {
    missing = company.founderName
      ? "No next generation is named alongside them yet. That is the one thing missing, and it is exactly what changes when a son or daughter steps in, so this company is re-checked automatically."
      : "The site does not name anyone in charge yet, so there is no founder-and-successor pair to confirm. It is re-checked automatically as sites get rebuilt.";
  }

  const headline = hasSignal
    ? "Fits your criteria, and a succession signal was confirmed."
    : "Fits every criterion you set. No succession signal on the page yet.";

  return { headline, points, missing };
}
