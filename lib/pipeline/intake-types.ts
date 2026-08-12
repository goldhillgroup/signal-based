/**
 * The client-safe half of intake.
 *
 * Split from intake.ts because that file reaches openrouter -> settings ->
 * the server-side Supabase client. Importing any of it from a "use client"
 * component would drag server code (and its secrets) into the browser bundle.
 * Types and pure reducers live here so both sides can share ONE definition of
 * what an answer does, rather than the UI re-implementing it and drifting.
 */

import { US_STATES } from "./us-states";
import { INDUSTRY_META } from "../signal-meta";
import type { Industry, SearchMode } from "../supabase/types";

export const VALID_STATE_CODES = new Set(US_STATES.map((s) => s.code));
// All eight ICP families. Derived from INDUSTRY_META rather than listed again,
// so a vertical added to the profile cannot be silently rejected by the intake
// parser while every other part of the pipeline accepts it.
export const VALID_INDUSTRIES: Industry[] = Object.keys(INDUSTRY_META) as Industry[];
export const VALID_MODES: SearchMode[] = ["signal", "filter", "hybrid"];

/** Hard ceiling on questions. The point is a fast start, not an interview. */
export const MAX_QUESTIONS = 3;

export interface IntakeQuestion {
  /** Which field this fills. Also how the UI knows what to do with the answer. */
  field: "industry" | "states" | "band" | "mode" | "target";
  question: string;
  options: { label: string; value: string }[];
  /** Applied verbatim if he skips — so "skip" is always safe. */
  skipLabel: string;
}

export interface IntakeResult {
  industry: Industry;
  states: string[];
  mode: SearchMode;
  targetSignals: number;
  revenueMinMusd: number | null;
  revenueMaxMusd: number | null;
  /** Up to MAX_QUESTIONS. Empty means the request was complete — just run it. */
  questions: IntakeQuestion[];
  /** Plain-English record of everything inferred rather than stated. */
  assumptions: string[];
  /** Echoed back so the UI can show what it understood before spending money. */
  summary: string;
}

export function labelFor(i: Industry): string {
  return i === "landscaping" ? "landscaping" : "home building";
}

export function bandLabel(min: number | null, max: number | null): string {
  if (min === null && max === null) return "no revenue limit";
  if (min === null) return `under $${max}M`;
  if (max === null) return `$${min}M+`;
  return `$${min}-${max}M`;
}

/**
 * Fold a clarifying answer back into the parsed result.
 *
 * Every branch validates before assigning, so an answer that somehow arrives
 * malformed leaves the previous (already runnable) value in place instead of
 * corrupting the search.
 */
export function applyAnswer(
  result: IntakeResult,
  field: IntakeQuestion["field"],
  value: string
): IntakeResult {
  const next = { ...result };
  switch (field) {
    case "industry":
      if (VALID_INDUSTRIES.includes(value as Industry)) next.industry = value as Industry;
      break;
    case "states": {
      const codes = value
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => VALID_STATE_CODES.has(s));
      if (codes.length) next.states = codes;
      break;
    }
    case "band": {
      const [lo, hi] = value.split(":");
      next.revenueMinMusd = lo ? Number(lo) : null;
      next.revenueMaxMusd = hi ? Number(hi) : null;
      break;
    }
    case "mode":
      if (VALID_MODES.includes(value as SearchMode)) next.mode = value as SearchMode;
      break;
    case "target": {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) next.targetSignals = Math.min(Math.round(n), 200);
      break;
    }
  }
  return next;
}

/**
 * Human-readable vertical name, tolerating "not decided yet".
 * Moved here when parse-query.ts (a regex parser that understood 9 of 50
 * states) was deleted in favour of intake.ts.
 */
/**
 * How a search names the verticals it covered, for the folder title.
 *
 * Two verticals were hardcoded and everything else fell through to the string
 * "landscaping or home building" — so a search for manufacturing produced a
 * folder called "landscaping or home building companies in Texas". The folder
 * title is how a search is identified for the rest of its life, and it was
 * confidently naming the wrong trade.
 *
 * A list, because a search can now cover several. Three or more are counted
 * rather than listed: "landscaping, home building, construction, specialty
 * trades and manufacturing companies in Texas" is not a title anyone can scan.
 */
export function industryLabel(industries: Industry[] | Industry | null): string {
  const list = Array.isArray(industries) ? industries : industries ? [industries] : [];
  if (list.length === 0) return "family-owned";
  const names = list.map((i) => INDUSTRY_META[i]?.label.toLowerCase() ?? i);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} verticals of`;
}
