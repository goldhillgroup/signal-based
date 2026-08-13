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
  /** The company's own words. Null for a cut company with no quote — the
   *  reason is shown in its own block and does not need repeating. */
  signalDetail: string | null;
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

/**
 * A name field holding a SENTENCE, trimmed back to the name.
 *
 * The classifier is asked for a person and occasionally returns the clause it
 * found them in. One live signal lead read
 *
 *   founder: "Joe Harris started the family's lumber/building business"
 *
 * which is true, is useful, and is not a name — it renders as the founder on
 * the card, in the drawer and in the exported sheet, where every other row
 * holds two words. The fix is to cut at the verb that turned the name into
 * prose and keep what came before it.
 *
 * DELIBERATELY NARROW. It cuts only at verbs and possessive connectives, never
 * at a bare "and", because co-founders are real and common — "Bill and Beth
 * Hewitt" and "John Hewitt and Jesse Hewitt" are correct values that a greedier
 * rule would mangle. Measured across 625 companies this touches 1 row, which is
 * the right size for a rule about a rare failure: anything it fires on more
 * often is cutting names it should have left alone.
 */
const PROSE_WORDS =
  "started|founded|joined|took|takes|runs|ran|leads|led|owns|owned|began|opened|works|worked|serves|served|built|created|established|acquired|purchased|bought|has|have|had|is|was|were|and his|and her|along with|together with";
/** The verb that turns a name into a sentence, somewhere after the name. */
const NAME_PROSE_RE = new RegExp(`\\s+\\b(?:${PROSE_WORDS})\\b`, "i");
/** The same verb with nothing in front of it — no name to keep. */
const STARTS_WITH_PROSE_RE = new RegExp(`^(?:${PROSE_WORDS})\\b`, "i");

export function cleanPersonName(v: string | null | undefined): string | null {
  if (!v) return null;
  let t = String(v).replace(/\s+/g, " ").trim();
  // A value that OPENS with the verb has no name in front of it to keep —
  // "founded the company in 1962" is a fact about a founder, not a founder.
  if (STARTS_WITH_PROSE_RE.test(t)) return null;
  const cut = t.search(NAME_PROSE_RE);
  if (cut > 0) t = t.slice(0, cut).trim();
  // Dangling punctuation left by the cut — but NOT a trailing period, which is
  // almost always an abbreviation ("Rich Cording, Sr.", "James E. Hornung").
  // Stripping it turned a correct name into a subtly wrong one.
  t = t.replace(/[,;:\-–—&]+$/, "").trim();
  return realName(t) ? t : null;
}

/**
 * Is this a name Jonathan can actually act on?
 *
 * The product's promise is a person he can look up and call. "Francisco Sr."
 * and "Eliseo" are not that — they are how a customer review refers to someone,
 * not an identification. Both reached the sheet as confirmed succession pairs
 * (one at HIGH confidence) off pages where nobody's surname ever appeared.
 *
 * Callable means at least two tokens once a generational suffix is removed, so
 * "Francisco Sr." fails while "Francisco Ruiz Sr." passes. Measured against the
 * 46 signal leads on file this demotes exactly 2, and both are cases where the
 * page genuinely never gave a full name.
 *
 * Demotion, not deletion: such a company stays a family-owned fit lead. The
 * business is real and may be worth a call — what is not supported is the
 * stronger claim that a named founder-and-successor pair was confirmed.
 */
const GENERATIONAL_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
export function callableName(v: string | null | undefined): boolean {
  if (!realName(v ?? null)) return false;
  const tokens = String(v)
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !GENERATIONAL_SUFFIX.test(t));
  return tokens.length >= 2;
}

/**
 * Is this a real business name, or scaffolding the crawler picked up?
 *
 * A live run put "CURRENT_LIVE_SITE" in the folder as a company. It came off a
 * staging banner, and it reached the sheet as something Jonathan was invited to
 * call. Template tokens, SEO title furniture and CMS placeholders all look like
 * names to a classifier reading page text.
 */
const PLACEHOLDER_NAME_RE =
  /^(current_live_site|untitled|home ?page|new ?page|page ?title|your ?(company|business|site)|company ?name|site ?name|lorem ipsum|test(ing)? ?(site|page|company)?|example|placeholder|default|index|welcome|coming soon|under construction|localhost|staging|wordpress site|my ?(site|blog))$/i;

export function realCompanyName(v: string | null | undefined): boolean {
  if (!v) return false;
  const t = String(v).trim();
  if (t.length < 2 || t.length > 90) return false;
  // ALL_CAPS_WITH_UNDERSCORES is a token, never a trading name.
  if (/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(t)) return false;
  if (/^https?:|^www\./i.test(t)) return false;
  return !PLACEHOLDER_NAME_RE.test(t.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim());
}

/**
 * Does a company with NO succession pair still show enough to be a lead?
 *
 * The gap this closes. `stillFamilyOwned` is deliberately generous — the prompt
 * says a company only fails it "when there's a real, specific reason in the
 * text", because cutting a real family firm on a page that simply never
 * mentions ownership is the more expensive error. Correct for that gate.
 *
 * But in hybrid/filter mode it was the ONLY family test a fit-only lead had to
 * pass, so "the page says nothing" resolved to "family-owned: true" and the
 * company became a lead. Measured on one live run: 9 of 24 leads named no
 * individual at all, and five were solo architecture studios — which the
 * client's written ICP excludes by name ("not lifestyle businesses or solo
 * professional practices"). They had not qualified; they had merely failed to
 * disqualify themselves.
 *
 * So a lead with no pair needs one POSITIVE piece of evidence: somebody
 * callable to ring, or the company's own family/generational language. Neither
 * is a high bar, and a page offering neither has told us nothing — which is not
 * the same as telling us it fits.
 */
export function fitOnlyIsLeadWorthy(
  founderName: string | null | undefined,
  familyLanguageOnPage: boolean,
  supportingSignals: string[] | null | undefined
): boolean {
  if (callableName(founderName)) return true;
  if (familyLanguageOnPage) return true;
  return Array.isArray(supportingSignals) && supportingSignals.length > 0;
}

/**
 * Is the family link actually STATED, or merely implied by a shared surname?
 *
 * 39 of 44 signal leads share a surname between the two named people — which is
 * exactly what you expect of a family business, and exactly why the surname
 * proves nothing on its own. A staff member who happens to be a Wade is not
 * evidence that Bret Wade is handing the company to them.
 *
 * Two things count as stated:
 *   - the evidence quote uses a relationship or handover word, or
 *   - the two names carry a matching generational suffix (Sr./Jr., II/III),
 *     which is an explicit claim about generation, not a coincidence of names.
 *
 * "3rd generation", "joined his father", "took over" and "son of founder" all
 * qualify. A quote that is two job titles pasted together does not.
 */
const RELATIONSHIP_RE =
  /\b(son|daughter|sons|daughters|father|mother|dad|mom|parents?|family|families|generation|grand(son|daughter|father)|joined (his|her|the)|took over|passed (down|along|the)|succeed(ed|s|ing)?|hand(ed|ing)? (over|down)|heir|children|kids|nephew|niece)\b/i;
const SUFFIX_RE = /\b(jr|sr|ii|iii|iv)\b\.?/i;

export function relationshipStated(
  quote: string | null | undefined,
  founderName: string | null | undefined,
  nextGenName: string | null | undefined
): boolean {
  if (quote && RELATIONSHIP_RE.test(quote)) return true;
  // Sr. paired with Jr. is a statement about generation. Two people who merely
  // both lack a suffix are not.
  const f = SUFFIX_RE.test(founderName ?? "");
  const n = SUFFIX_RE.test(nextGenName ?? "");
  return f && n;
}

/**
 * The confidence a lead has actually EARNED, which may be lower than the one
 * the model claimed.
 *
 * "High" is a promise that Jonathan can act without checking. Two leads carried
 * it without supporting it: Hewitt Garden & Design had no evidence quote at all,
 * and Tommy Waters Custom Homes had a quote describing only the successor's job,
 * with nothing anywhere stating he was the owner's son — a shared surname doing
 * all the work.
 *
 * So "high" now requires BOTH a receipt and a stated relationship. Anything
 * missing either drops to "verify", which is not a demotion of the lead — it is
 * an accurate label meaning "real, worth a look, check it yourself first". The
 * lead, the names and the quote are untouched.
 *
 * HAND-AUDITED LEADS ARE EXEMPT, and that is the whole point of the rule rather
 * than an exception to it. This gate exists because a MODEL's claim needs
 * evidence on the page. Jonathan's own list carries no quote because it was
 * imported rather than crawled — the receipt is that he checked it himself.
 * Applying the gate blindly demoted 6 of his own vetted companies and told him
 * to re-verify his own work, which is a different way of being wrong.
 */
export function earnedConfidence(
  claimed: "high" | "medium" | "verify" | null,
  quote: string | null | undefined,
  founderName: string | null | undefined,
  nextGenName: string | null | undefined,
  handVerified = false
): "high" | "medium" | "verify" | null {
  if (!claimed) return claimed;
  if (handVerified) return claimed;
  const hasReceipt = Boolean(quote && quote.trim());
  const stated = relationshipStated(quote, founderName, nextGenName);
  if (hasReceipt && stated) return claimed;
  return "verify";
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
  // NULL for a cut company with no quote, not a filler sentence.
  //
  // It used to read "Cut before this was established. The reason is below." —
  // which sat between two copies of the reason itself, because the card prints
  // "Cut because: X" above it and whyThisLead printed X again underneath. Three
  // blocks, one fact, and the middle one pointing at the wrong place. A real
  // quote is still shown: that is something the site actually said, and it is
  // evidence either way.
  const detail: string | null =
    c.evidence?.quote ??
    (c.status === "rejected"
      ? null
      : founder && nextGen
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
    // Empty for a cut company: the card already prints "Cut because: <reason>"
    // in its own block, and repeating it here was the third copy.
    whyThisLead: rejected ? "" : (fit?.headline ?? ""),
    missing: rejected ? null : (fit?.missing ?? null),
    surfacedAt: c.firstSeenAt,
    location: location || "Location not stated",
    score,
    factors,
    sourceUrl: c.evidence?.sourceUrl ?? c.sourceUrl,
  };
}

/**
 * Only let a revenue estimate through if it is actually a revenue estimate.
 *
 * The field is stored straight from the model and rendered in the sheet under
 * "revenue_band", where the client reads it as a fact. In practice the model
 * sometimes answers in prose, and the sheet ended up carrying:
 *
 *   "$3-8M plausible but UN (est.)"
 *   "Unconfirmed; single-so (est.)"
 *   "Genuinely unconfirmed (est.)"
 *
 * Every one of those is the model saying "I do not know" dressed as a number.
 * "Size not stated" is the honest rendering of that, and it is already what an
 * absent value shows — 58% of leads have no figure at all, so it is the common
 * case rather than an embarrassment.
 *
 * Accepts what a range actually looks like: a currency figure, optionally a
 * second one, optionally "+" or "M"/"K", optionally an "(est.)" suffix.
 */
export function cleanRevenueBand(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = String(v).trim();
  // A real answer is short. Anything longer is a sentence about uncertainty.
  if (t.length > 28) return null;
  // Must contain a currency amount somewhere.
  if (!/\$\s?\d/.test(t)) return null;
  // Reject the hedging words that turn a figure into a non-answer.
  if (/\b(unconfirmed|plausible|unclear|unknown|not stated|uncertain|guess|maybe)\b/i.test(t)) return null;
  return t;
}

/**
 * A job title, or nothing.
 *
 * founderTitle/nextGenTitle sit beside a real name in the sheet, and the model
 * sometimes answers with an explanation instead of a title:
 *
 *   "Owner (implied — leads crew, gives quotes, referenced by customers as th"
 *   "No formal title on the company's own About"
 *
 * DELIBERATELY CONSERVATIVE, because a first, blunter version of this did real
 * damage in a dry run:
 *
 *   "Founders (retired)"  ->  "Founders"
 *
 * That parenthetical is not commentary — a retired founder is precisely what
 * disqualifies a lead under the "senior person must still be there" test, and
 * stripping it would hide the disqualifying fact behind a tidier-looking title.
 * The same pass also discarded "VP & Head of Landscape / Project Manager", a
 * perfectly real title, for being one word over an arbitrary cap.
 *
 * So: only remove a parenthetical that is visibly the model hedging, only
 * reject a value that is visibly an absence, and otherwise leave it alone.
 * Losing a true title costs more than tidying an untidy one.
 */
const HEDGE =
  /\b(implied|inferred|assumed|presumably|likely|referred to as|referenced (by|in)|from (the |client )?testimonial|testimonials?|not stated|no title|unclear|based on|apparent(ly)?)\b/i;

export function cleanTitle(v: string | null | undefined): string | null {
  if (!v) return null;
  let t = String(v).replace(/\s+/g, " ").trim();

  // An absence dressed as a value.
  if (/^(no|not|none|unknown|unclear|n\/a)\b/i.test(t)) return null;

  // Drop a trailing parenthetical ONLY when it is the model explaining itself.
  // "(retired)", "(Sr.)", "(II)" and the like are facts and stay.
  // A trailing parenthetical, closed or truncated. Removed only if it hedges.
  t = t.replace(/\s*[(—][^)]*\)?\s*$/, (m) => (HEDGE.test(m) ? "" : m)).trim();
  t = t.replace(/[,;]+$/, "").trim();
  if (!t) return null;

  // Still a sentence after that? Then it was never a title.
  if (t.split(/\s+/).length > 12 || t.length > 90) return null;
  return t;
}
