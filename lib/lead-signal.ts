import type { Company } from "./company";
import { explainFit } from "./fit-explanation";

/**
 * A lead as a LEAD, rather than as a database row.
 *
 * The table used to answer "what is this record" — company, industry, status,
 * verification, last checked. Correct, and not what anyone opens a lead list
 * for. The scope's Phase 1 deliverable is "the signal behind each name, the
 * reason it surfaced now, and the contact to start with", and none of those
 * three were on the row: the signal quote lived one click deep in a drawer,
 * the reasoning did not exist, and the email was rendered as the word "Found".
 *
 * Shape follows the sample lead list format — signal type, signal detail, why
 * this lead, date, location, contact, score, source — because that format is
 * built around the question a person actually has in front of a list, which is
 * "why am I calling this one, and what do I say".
 *
 * Everything here is DERIVED from what the pipeline already stored. Nothing is
 * invented, and where a fact is genuinely absent it is absent rather than
 * filled with a plausible-looking default.
 */

export type SignalType = "succession_pair" | "succession_verify" | "family_owned_fit";

export const SIGNAL_TYPE_META: Record<
  SignalType,
  { label: string; blurb: string; color: string; bg: string }
> = {
  succession_pair: {
    label: "Succession pair",
    blurb: "Founder and next generation both named and active",
    color: "#0b7a0b",
    bg: "#e2f6e2",
  },
  succession_verify: {
    label: "Needs a look",
    blurb: "Succession language found, but the pairing is not airtight",
    color: "#9a4a1f",
    bg: "#fbe4d7",
  },
  family_owned_fit: {
    label: "Family-owned fit",
    blurb: "Right trade, right territory, family-run, no successor named yet",
    color: "#3d5a80",
    bg: "#e1e9f2",
  },
};

export interface Lead {
  signalType: SignalType;
  /** The specific fact, in the company's own words where one was quoted. */
  signalDetail: string;
  /** Why this one is worth a call. */
  whyThisLead: string;
  /** What is missing, when something is. */
  missing: string | null;
  /**
   * When this surfaced — NOT when the succession happened.
   *
   * A page saying "now joined by his two sons" carries no date, and the
   * business will not tell you when it changed hands. Dating it "2026-08"
   * because that is when we read the page would be inventing an event date, so
   * this is labelled as what it is: when the crawler found it.
   */
  surfacedAt: string;
  location: string;
  /** 1-10, from named factors — see scoreFactors. */
  score: number;
  factors: string[];
  sourceUrl: string | null;
}

/** The people whose presence IS the signal. */
export function leadPeople(c: Company): { founder: string | null; nextGen: string | null } {
  const fmt = (n: string | null, t: string | null) => (n ? (t ? `${n}, ${t}` : n) : null);
  return { founder: fmt(c.founderName, c.founderTitle), nextGen: fmt(c.nextGenName, c.nextGenTitle) };
}

export function signalTypeOf(c: Company): SignalType {
  if (c.hasSignal && c.confidence === "verify") return "succession_verify";
  if (c.hasSignal) return "succession_pair";
  return "family_owned_fit";
}

/**
 * 1-10, and every point is attributable.
 *
 * A score nobody can explain is worse than no score: it gets trusted for a
 * week and then quietly ignored forever, and there is no way to argue with it.
 * So the factors that produced it travel with it and are shown next to it.
 *
 * Weighted by what actually decides whether a call happens. A confirmed
 * founder-and-successor pair is the product; a reachable verified address is
 * what turns it into a conversation this week rather than a research task.
 */
export function scoreFactors(c: Company): { score: number; factors: string[] } {
  const factors: string[] = [];
  let score = 0;

  if (c.hasSignal && (c.confidence === "high" || c.confidence === "medium")) {
    score += 6;
    factors.push("Founder and successor both confirmed");
  } else if (c.hasSignal) {
    score += 4;
    factors.push("Succession language found, not yet confirmed");
  } else {
    score += 2;
    factors.push("Fits the profile, no successor named yet");
  }

  if (c.evidence?.quote) {
    score += 1;
    factors.push("Quoted from the company's own page");
  }
  if (c.nextGenName) {
    score += 1;
    factors.push(`Next generation named: ${c.nextGenName}`);
  }

  const v = c.contact?.verificationStatus;
  if (c.contact?.email && v === "valid") {
    score += 2;
    factors.push("Verified deliverable email");
  } else if (c.contact?.email) {
    score += 1;
    factors.push("Email found, deliverability unconfirmed");
  }

  return { score: Math.max(1, Math.min(10, score)), factors };
}

export function toLead(c: Company): Lead {
  const fit = explainFit(c);
  const { founder, nextGen } = leadPeople(c);
  const { score, factors } = scoreFactors(c);

  // The signal detail, best available first: the company's own words, then the
  // people found, then an honest statement that neither exists yet.
  const detail =
    c.evidence?.quote ??
    (founder && nextGen
      ? `${founder} and ${nextGen} are both named on the site.`
      : founder
        ? `${founder} is named as the person in charge. No successor on the page yet.`
        : "No individual is named on the site yet.");

  const location = [c.city, c.state].filter((s) => s && s !== "-").join(", ");

  return {
    signalType: signalTypeOf(c),
    signalDetail: detail,
    whyThisLead: fit?.headline ?? "",
    missing: fit?.missing ?? null,
    surfacedAt: c.firstSeenAt,
    location: location || "Location not stated",
    score,
    factors,
    sourceUrl: c.evidence?.sourceUrl ?? c.sourceUrl,
  };
}
