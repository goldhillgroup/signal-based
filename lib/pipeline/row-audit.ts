import type { ClassificationResult } from "./openrouter";
import { callableName } from "../lead-signal";

/**
 * A SECOND LOOK AT THE ASSEMBLED ROW, before it is written.
 *
 * There is already a second check on the strongest claim: a confirmed
 * founder-and-successor pair gets a disprove pass, a separate model call asked
 * to REFUTE it. That is the expensive claim and it deserves the expensive
 * check.
 *
 * Everything else got one look. And the fit-only tier is where every bad lead
 * of the last two days actually came from:
 *
 *   a Florida lead whose city was Raleigh-Durham   two fields contradicting
 *   an owner called "Erik A"                        a name nobody can ring
 *   a company called CURRENT_LIVE_SITE              a staging banner
 *   five solo architecture studios                  excluded by the written ICP
 *
 * None needed a model to spot. Each is one field disagreeing with another, or
 * with something already known — which is exactly what code is good at and what
 * a single pass over a page is bad at, because the classifier answers thirteen
 * questions at once and never compares its own answers.
 *
 * So this runs over the finished classification and asks: does this row
 * contradict itself? It costs nothing, it runs on EVERY company rather than
 * only the ones claiming a pair, and it returns findings rather than a verdict
 * — the caller decides whether a finding downgrades a lead or kills it.
 *
 * Deliberately NOT a re-judgement. It never asks whether a company is a good
 * prospect; the gates do that. It asks whether what was written about it hangs
 * together.
 */
export interface RowFinding {
  /** The field whose value cannot be trusted. */
  field: "companyName" | "founderName" | "nextGenName" | "city" | "quote" | "revenue";
  /** Plain sentence, safe to show a person. */
  note: string;
  /** true when the value should be dropped rather than shown. */
  drop: boolean;
}

/** Metros that name a state — unambiguous ones only, mirroring cleanCity. */
const METRO_STATE: Record<string, string> = {
  raleigh: "NC", durham: "NC", charlotte: "NC", atlanta: "GA", nashville: "TN",
  memphis: "TN", phoenix: "AZ", denver: "CO", "las vegas": "NV", portland: "OR",
  seattle: "WA", chicago: "IL", detroit: "MI", minneapolis: "MN",
  "kansas city": "MO", "new orleans": "LA", indianapolis: "IN", columbus: "OH",
  cleveland: "OH", louisville: "KY", richmond: "VA", baltimore: "MD",
  philadelphia: "PA", pittsburgh: "PA", boston: "MA", providence: "RI",
  hartford: "CT", newark: "NJ", houston: "TX", dallas: "TX", austin: "TX",
  "san antonio": "TX", miami: "FL", orlando: "FL", tampa: "FL",
  "los angeles": "CA", "san diego": "CA", "san francisco": "CA",
  "new york": "NY", buffalo: "NY",
};

export function auditRow(
  c: ClassificationResult,
  ctx: { state: string | null; pageText: string; domain: string }
): RowFinding[] {
  const out: RowFinding[] = [];

  // ── The two people ──────────────────────────────────────────────────────
  // A pair is only a pair if both are somebody you could look up and ring.
  // This is already enforced where pairs are judged; repeated here because a
  // FIT-only row also prints founderName as "who to contact".
  if (c.founderName && !callableName(c.founderName)) {
    const tokens = c.founderName.trim().split(/\s+/);
    // A first name is incomplete, not wrong — "ask for Paula" is how a small
    // business is actually reached. An initial pretending to be a surname is
    // different: it reads as a full name and is not one.
    const initialAsSurname = tokens.length > 1 && tokens[tokens.length - 1].replace(/\W/g, "").length < 2;
    if (initialAsSurname) {
      out.push({
        field: "founderName",
        note: `"${c.founderName}" is a first name with the surname withheld, not a name that can be looked up.`,
        drop: true,
      });
    }
  }

  if (c.founderName && c.nextGenName && c.founderName.trim() === c.nextGenName.trim()) {
    out.push({
      field: "nextGenName",
      note: "The founder and the successor are the same person.",
      drop: true,
    });
  }

  // ── The location ────────────────────────────────────────────────────────
  if (c.city && ctx.state) {
    const low = c.city.toLowerCase();
    const wrong = Object.entries(METRO_STATE).find(([m, st]) => low.includes(m) && st !== ctx.state);
    if (wrong) {
      out.push({
        field: "city",
        note: `The page says ${c.city}, which is in ${wrong[1]}, but this company was found searching ${ctx.state}.`,
        drop: true,
      });
    }
  }

  // ── The company name ────────────────────────────────────────────────────
  // A name lifted from the page's own furniture rather than its masthead.
  if (c.companyName && ctx.domain) {
    const bare = ctx.domain.replace(/^www\./, "").split(".")[0].toLowerCase();
    const name = c.companyName.toLowerCase().replace(/[^a-z]/g, "");
    // Only flagged when the name is ALSO implausible — a real company whose
    // name differs from its domain is completely ordinary.
    if (name.length > 60 && !name.includes(bare.slice(0, 6))) {
      out.push({
        field: "companyName",
        note: "The business name reads as a page title rather than a name.",
        drop: false,
      });
    }
  }

  // ── The receipt ─────────────────────────────────────────────────────────
  // A quote naming somebody the row does not name is a quote about a different
  // company, or a person the classifier decided not to record — either way the
  // pair cannot rest on it.
  if (c.quote && c.nextGenName) {
    const first = c.nextGenName.trim().split(/[\s,]+/)[0].toLowerCase();
    if (first.length > 2 && !c.quote.toLowerCase().includes(first)) {
      out.push({
        field: "quote",
        note: "The evidence quote does not mention the successor it is offered as proof of.",
        drop: false,
      });
    }
  }

  return out;
}
