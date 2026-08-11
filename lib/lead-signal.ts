import { settledContact, type Company } from "./company";
import { isSharedInbox } from "./pipeline/page-email";
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

export type SignalType =
  | "succession_pair"
  | "succession_verify"
  | "family_owned_fit"
  | "not_a_fit";

export const SIGNAL_TYPE_META: Record<
  SignalType,
  { label: string; short: string; blurb: string; color: string; bg: string }
> = {
  // PLAIN ENGLISH, not vocabulary. These started as "Qualified", "Verify" and
  // "Fit only" — words with a precise meaning inside the classifier and none
  // at all on a lead card. The replacements say the actual finding, so nobody
  // has to be taught the scheme before reading the list: the label names WHO
  // was found, not what bucket the row landed in.
  succession_pair: {
    label: "Founder + successor",
    // A table column is ~13% of the width. The full labels clipped mid-word
    // ("Good fit, no successor ye"), which is worse than a shorter true label:
    // the card and the tab still carry the full wording, and the table cell
    // shows the whole short one on hover.
    short: "Both named",
    blurb: "Both named on the site, both running it today",
    color: "#0b7a0b",
    bg: "#e2f6e2",
  },
  succession_verify: {
    label: "Probably, worth checking",
    short: "Worth a check",
    blurb: "Reads like a handover, but the wording is not airtight",
    color: "#9a4a1f",
    bg: "#fbe4d7",
  },
  family_owned_fit: {
    label: "Good fit, no successor yet",
    short: "No successor",
    blurb: "Right trade, right area, family-run, nobody named to take over",
    color: "#3d5a80",
    bg: "#e1e9f2",
  },
  // Rejected companies are shown now rather than hidden, so they need a type
  // of their own. Without one they fell through to family_owned_fit and were
  // labelled "Good fit, no successor yet" — the CSV export shipped all 39
  // rejections under that heading, which reads as a recommendation to call a
  // company the test had specifically thrown out.
  //
  // Grey, not red. These are not errors and several are real family businesses
  // in the right trade; they simply failed one gate. Red would say "something
  // went wrong here", which is the wrong reading of a working filter.
  not_a_fit: {
    label: "Not a fit",
    short: "Not a fit",
    blurb: "Cut by one of your gates — the reason is on the row",
    color: "#6b7280",
    bg: "#f1f2f4",
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
  /** Sort key only. Never rendered — see scoreFactors. */
  score: number;
  factors: string[];
  sourceUrl: string | null;
}

/**
 * Is this actually a person's name, or a placeholder standing in for one?
 *
 * The pipeline and the audit both write "-", "n/a", "unknown", "none" and the
 * empty string when a name is absent, and a plain truthiness test passes every
 * one of them through. They were rendering as the named contact in the "Who to
 * reach" column, on the card, and in the CSV's `next_gen` field — a lead list
 * whose contact column reads "-" is worse than one that says nothing, because
 * it looks like data.
 */
function realName(v: string | null): boolean {
  if (!v) return false;
  const t = v.trim();
  if (t.length < 2) return false;
  return !/^(-+|n\/?a|none|null|unknown|not stated|not listed|tbd|\?+)$/i.test(t);
}

/** The people whose presence IS the signal. */
export function leadPeople(c: Company): { founder: string | null; nextGen: string | null } {
  const fmt = (n: string | null, t: string | null) =>
    realName(n) ? (realName(t) ? `${n!.trim()}, ${t!.trim()}` : n!.trim()) : null;
  return { founder: fmt(c.founderName, c.founderTitle), nextGen: fmt(c.nextGenName, c.nextGenTitle) };
}

export function signalTypeOf(c: Company): SignalType {
  // Status FIRST. A rejected company can carry has_signal — plenty were cut on
  // revenue or trade while their page did name a founder and a successor — so
  // testing the signal before the status would badge a cut company "Founder +
  // successor" and put it back among the leads.
  if (c.status === "rejected") return "not_a_fit";
  if (c.hasSignal && c.confidence === "verify") return "succession_verify";
  if (c.hasSignal) return "succession_pair";
  return "family_owned_fit";
}

/**
 * A SORT KEY. Never shown, and that is the point.
 *
 * This was a 1-10 score printed on every card and every table row. Measured
 * against the real database it produced: 30 of 33 leads at 4 or below, median
 * 3, and a ceiling of 9 reachable only with a confirmed founder-and-successor
 * pair AND a verified deliverable email.
 *
 * So the client opens the list he paid for and reads a column of 2s and 3s out
 * of 10. Those are correctly-qualified family-owned companies in his own
 * territory — the product working exactly as intended — and the number tells
 * him they are failures. The scale was measuring distance from a perfect lead
 * rather than the value of a real one, and almost nothing is a perfect lead.
 *
 * The ordering it produces is genuinely useful, so it stays and drives the
 * default sort. It is simply never rendered: the row already shows the signal
 * type and the email status, which are the two things the number was made of,
 * stated as facts rather than compressed into a grade.
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

  // A shared inbox is worth having and is NOT the same lead. A verified
  // info@ used to score exactly as high as a verified will@, which put a
  // screened mailbox level with the successor himself at the top of a list
  // sorted by score. Reaching the person by name is the product.
  const settled = settledContact(c);
  const v = settled?.verificationStatus;
  const shared = isSharedInbox(settled?.email);
  if (settled?.email && v === "valid") {
    score += shared ? 1 : 2;
    factors.push(shared ? "Verified, but a shared inbox" : "Verified deliverable email");
  } else if (settled?.email) {
    score += shared ? 0 : 1;
    factors.push(shared ? "Shared inbox, deliverability unconfirmed" : "Email found, deliverability unconfirmed");
  }

  return { score: Math.max(1, Math.min(10, score)), factors };
}

export function toLead(c: Company): Lead {
  const fit = explainFit(c);
  const { founder, nextGen } = leadPeople(c);
  const { score, factors } = scoreFactors(c);

  // The signal detail, best available first: the company's own words, then the
  // people found, then an honest statement that neither exists yet.
  //
  // The INFERRED sentences are suppressed for a cut company. They are built
  // from founder/next-gen fields the classifier populated before the gates ran,
  // so a company rejected for having only one generation on the page was still
  // printing "A and B are both named on the site" immediately above "Cut
  // because: only one generation is on the leadership page". A real quote is
  // kept — that is something the site actually said, and it is evidence either
  // way — but the derived claim contradicts the verdict and has to go.
  const detail =
    c.evidence?.quote ??
    (c.status === "rejected"
      ? "Cut before this was established. The reason is below."
      : null) ??
    (founder && nextGen
      ? `${founder} and ${nextGen} are both named on the site.`
      : founder
        ? `${founder} is named as the person in charge. No successor on the page yet.`
        : "No individual is named on the site yet.");

  const location = [c.city, c.state].filter((s) => s && s !== "-").join(", ");

  const rejected = c.status === "rejected";

  return {
    signalType: signalTypeOf(c),
    signalDetail: detail,
    // For a cut company the useful sentence is why it was CUT, not why it would
    // have been worth calling. explainFit answers the second question and would
    // otherwise print an argument for a company the test rejected.
    whyThisLead: rejected ? (c.rejectionReason ?? "Cut by one of your gates.") : (fit?.headline ?? ""),
    missing: rejected ? null : (fit?.missing ?? null),
    surfacedAt: c.firstSeenAt,
    location: location || "Location not stated",
    score,
    factors,
    sourceUrl: c.evidence?.sourceUrl ?? c.sourceUrl,
  };
}
