/**
 * Free text in, a runnable search out.
 *
 * Replaces parse-query.ts's regex, which understood 9 of 50 states and failed
 * SILENTLY — "landscaping in Oregon" parsed to no state filter at all, and
 * "Texas + Oklahoma" quietly dropped Oklahoma while looking like it worked. A
 * search that returns the wrong thing confidently is worse than one that
 * refuses, so the rules here are:
 *
 *   1. NEVER silently drop part of the request. Every state he names either
 *      gets searched or gets surfaced back to him.
 *   2. Guess from his own history before guessing generically — if the last
 *      five searches were landscaping at $3-15M, a bare "Oregon" means that.
 *   3. Ask at most THREE questions, only where the answer actually changes
 *      which companies come back. Everything else is assumed out loud.
 *   4. Every question is skippable. Skipping is a real path, not a dead end:
 *      the defaults run and the assumptions are shown.
 *
 * The model only ever proposes — every field is validated against the known
 * state codes / industries / modes below before it can reach the pipeline.
 */

import { chat, extractJson, getExtractModel } from "./openrouter";
import { US_STATES, AGREED_STATES, stateNameFor } from "./us-states";
import type { Industry, SearchMode } from "../supabase/types";
import {
  VALID_STATE_CODES,
  VALID_INDUSTRIES,
  VALID_MODES,
  MAX_QUESTIONS,
  labelFor,
  bandLabel,
  type IntakeQuestion,
  type IntakeResult,
} from "./intake-types";

export {
  MAX_QUESTIONS,
  applyAnswer,
  labelFor,
  bandLabel,
  type IntakeQuestion,
  type IntakeResult,
} from "./intake-types";

/** What his past searches say he usually means. */
export interface SearchHistory {
  industry: Industry | null;
  state: string | null;
  mode: SearchMode | null;
  revenue_min_musd: number | null;
  revenue_max_musd: number | null;
}

interface Defaults {
  industry: Industry;
  mode: SearchMode;
  targetSignals: number;
  revenueMinMusd: number | null;
  revenueMaxMusd: number | null;
  learned: string[];
}

/**
 * The adaptive part. Modal value of each field across his prior searches wins,
 * so the system converges on how HE works instead of on a hardcoded guess.
 * Falls back to the delivered baseline ($3-15M, hybrid) when there's no
 * history to learn from.
 */
export function defaultsFrom(history: SearchHistory[]): Defaults {
  const learned: string[] = [];
  const mode = <T,>(vals: (T | null)[]): T | null => {
    const counts = new Map<T, number>();
    vals.forEach((v) => v !== null && counts.set(v, (counts.get(v) ?? 0) + 1));
    let best: T | null = null;
    let n = 0;
    counts.forEach((c, v) => {
      if (c > n) {
        n = c;
        best = v;
      }
    });
    return best;
  };

  const usualIndustry = mode(history.map((h) => h.industry));
  const usualMode = mode(history.map((h) => h.mode));
  const usualMin = mode(history.map((h) => h.revenue_min_musd));
  const usualMax = mode(history.map((h) => h.revenue_max_musd));

  if (history.length > 0) {
    if (usualIndustry) learned.push(`you usually search ${labelFor(usualIndustry)}`);
    if (usualMin !== null || usualMax !== null) learned.push(`your usual band is ${bandLabel(usualMin, usualMax)}`);
  }

  return {
    industry: usualIndustry ?? "landscaping",
    mode: usualMode ?? "hybrid",
    targetSignals: 20,
    // Only inherit a band when he has actually set one before; otherwise the
    // delivered $3-15M baseline.
    revenueMinMusd: history.length > 0 && (usualMin !== null || usualMax !== null) ? usualMin : 3,
    revenueMaxMusd: history.length > 0 && (usualMin !== null || usualMax !== null) ? usualMax : 15,
    learned,
  };
}



const SYSTEM = `You turn a plain-English request for US business leads into structured search parameters.

The user is a family-business succession coach looking for companies where a founder AND a next-generation family member are both visible in leadership.

Return ONLY a JSON object:
{
  "industry": "landscaping" | "home_builder" | null,
  "states": ["CA", "TX"],
  "mode": "signal" | "filter" | "hybrid" | null,
  "targetSignals": number | null,
  "revenueMinMusd": number | null,
  "revenueMaxMusd": number | null,
  "unclear": ["industry" | "states" | "band" | "mode" | "target"],
  "summary": "one short sentence restating the request"
}

RULES
- states: 2-letter USPS codes. Expand regions to their full member list — "the Southeast" -> ["AL","AR","FL","GA","KY","LA","MS","NC","SC","TN","VA","WV"]; "New England" -> ["CT","ME","MA","NH","RI","VT"]; "the West Coast" -> ["CA","OR","WA"]; "Texas + Oklahoma" -> ["TX","OK"]. A city or metro maps to its state: "Bay Area" -> ["CA"], "DFW" -> ["TX"]. NEVER drop a location the user named. If no location at all is stated or implied, return [] and put "states" in unclear.
- industry: "lawn care", "landscape design", "tree service", "hardscaping", "irrigation", "grounds maintenance" are all "landscaping". "custom homes", "residential construction", "home builder", "general contractor", "remodeler" are all "home_builder". If neither is stated or implied, null and add "industry" to unclear.
- revenue: "$2-10M" -> min 2, max 10. "under $5M" -> min null, max 5. "$10M+" -> min 10, max null. "small" / "mid-size" are too vague — leave null and add "band" to unclear ONLY if the user gestured at size without a number.
- mode: "signal" only if they explicitly demand a succession signal on every result. "filter" if they explicitly say they just want a list with no signal needed. Otherwise null.
- targetSignals: only if they name a number of results/leads/companies they want. Otherwise null.
- unclear: list ONLY fields where a wrong guess would return materially different companies. Do not list a field you confidently inferred. Prefer fewer entries — an empty list is the best outcome.

Return the JSON and nothing else.`;

interface RawIntake {
  industry?: string | null;
  states?: unknown;
  mode?: string | null;
  targetSignals?: number | null;
  revenueMinMusd?: number | null;
  revenueMaxMusd?: number | null;
  unclear?: unknown;
  summary?: string | null;
}

const QUESTION_BUILDERS: Record<
  IntakeQuestion["field"],
  (d: Defaults) => IntakeQuestion
> = {
  industry: (d) => ({
    field: "industry",
    question: "Which kind of company?",
    options: [
      { label: "Landscaping", value: "landscaping" },
      { label: "Home builders", value: "home_builder" },
    ],
    skipLabel: `Use ${labelFor(d.industry)}`,
  }),
  states: (d) => ({
    field: "states",
    question: "Where should I look?",
    options: [
      ...AGREED_STATES.map((c) => ({ label: stateNameFor(c), value: c })),
      { label: "All four agreed states", value: AGREED_STATES.join(",") },
    ],
    skipLabel: `Use ${stateNameFor(AGREED_STATES[0])}`,
  }),
  band: (d) => ({
    field: "band",
    question: "What size company?",
    options: [
      { label: "$3-15M (baseline)", value: "3:15" },
      { label: "Under $3M", value: ":3" },
      { label: "$15M+", value: "15:" },
      { label: "No limit", value: ":" },
    ],
    skipLabel: `Use ${bandLabel(d.revenueMinMusd, d.revenueMaxMusd)}`,
  }),
  mode: (d) => ({
    field: "mode",
    question: "How strict should the results be?",
    options: [
      { label: "Signal-bearing first, but show all fits", value: "hybrid" },
      { label: "Only companies with a succession signal", value: "signal" },
      { label: "Just the list, no signal needed", value: "filter" },
    ],
    skipLabel: `Use ${d.mode}`,
  }),
  target: (d) => ({
    field: "target",
    question: "How many do you want?",
    options: [
      { label: "10", value: "10" },
      { label: "20", value: "20" },
      { label: "50", value: "50" },
    ],
    skipLabel: `Use ${d.targetSignals}`,
  }),
};

/**
 * Parse a free-text request. Never throws — a model failure or a garbled
 * response degrades to "ask him the basics", which is still a working path.
 */
export async function parseRequest(
  text: string,
  history: SearchHistory[] = []
): Promise<IntakeResult> {
  const d = defaultsFrom(history);
  const assumptions: string[] = [];

  let raw: RawIntake = {};
  try {
    const model = await getExtractModel();
    const out = await chat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: text.slice(0, 2000) },
      ],
      600,
      model,
      true
    );
    raw = extractJson<RawIntake>(out);
  } catch {
    // Model unavailable or unparseable — fall through to asking. Better a
    // question than a confidently wrong search.
    raw = { unclear: ["industry", "states"] };
  }

  // ── Validate everything the model proposed ──────────────────────────────
  const states = Array.isArray(raw.states)
    ? Array.from(
        new Set(
          raw.states
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim().toUpperCase())
            .filter((s) => VALID_STATE_CODES.has(s))
        )
      )
    : [];

  const industry = VALID_INDUSTRIES.includes(raw.industry as Industry)
    ? (raw.industry as Industry)
    : null;

  const mode = VALID_MODES.includes(raw.mode as SearchMode) ? (raw.mode as SearchMode) : null;

  const target =
    typeof raw.targetSignals === "number" && raw.targetSignals > 0
      ? Math.min(Math.round(raw.targetSignals), 200)
      : null;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const bandMin = num(raw.revenueMinMusd);
  const bandMax = num(raw.revenueMaxMusd);
  const bandStated = bandMin !== null || bandMax !== null;

  // ── Decide what to ask ──────────────────────────────────────────────────
  // Trust our own validation over the model's self-report: a field it filled
  // correctly is never a question, whatever it claimed in `unclear`.
  const flagged = new Set(
    Array.isArray(raw.unclear)
      ? raw.unclear.filter((u): u is string => typeof u === "string")
      : []
  );
  const ask: IntakeQuestion["field"][] = [];
  const consider = (field: IntakeQuestion["field"], missing: boolean) => {
    if (missing && ask.length < MAX_QUESTIONS) ask.push(field);
  };

  // Ordered by how much a wrong answer costs: searching the wrong industry or
  // the wrong state wastes the entire run; the rest only shifts the mix.
  consider("industry", industry === null);
  consider("states", states.length === 0);
  consider("band", !bandStated && flagged.has("band"));
  consider("mode", mode === null && flagged.has("mode"));
  consider("target", target === null && flagged.has("target"));

  // ── Record what we filled in, so nothing is inferred invisibly ──────────
  if (industry === null && !ask.includes("industry")) {
    assumptions.push(`assumed ${labelFor(d.industry)}`);
  }
  if (states.length === 0 && !ask.includes("states")) {
    assumptions.push(`assumed ${stateNameFor(AGREED_STATES[0])}`);
  }
  if (!bandStated) {
    assumptions.push(`assumed ${bandLabel(d.revenueMinMusd, d.revenueMaxMusd)}`);
  }
  if (mode === null) assumptions.push(`assumed ${d.mode} mode`);
  if (target === null) assumptions.push(`assumed ${d.targetSignals} results`);
  d.learned.forEach((l) => assumptions.push(l));

  const finalStates = states.length > 0 ? states : [AGREED_STATES[0]];
  const finalIndustry = industry ?? d.industry;

  return {
    industry: finalIndustry,
    states: finalStates,
    mode: mode ?? d.mode,
    targetSignals: target ?? d.targetSignals,
    revenueMinMusd: bandStated ? bandMin : d.revenueMinMusd,
    revenueMaxMusd: bandStated ? bandMax : d.revenueMaxMusd,
    questions: ask.map((f) => QUESTION_BUILDERS[f](d)),
    assumptions,
    summary:
      typeof raw.summary === "string" && raw.summary.trim()
        ? raw.summary.trim().slice(0, 200)
        : `${labelFor(finalIndustry)} companies in ${finalStates.map(stateNameFor).join(", ")}`,
  };
}
