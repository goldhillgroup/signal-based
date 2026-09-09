"use client";

import type { Company } from "@/lib/company";
import { rankFor, rungFor, RUNG_ORDER, DEFAULT_RULES } from "@/lib/lead-score";

/**
 * The verdict, on the lead list.
 *
 * WHY IT IS BACK. It was on the card, then taken off, and the drawer became
 * the only place a lead's 1-5 existed -- so scanning a list of thirty told you
 * nothing about which to open first, which is the one job a list has. Jonathan
 * asked where it had gone, which is the answer.
 *
 * BOTH HALVES. The number is what makes a list scannable and what the sort is
 * on; the sentence is what makes the number mean something. Printing the digit
 * alone was the earlier mistake -- "a 3 beside a company name says nothing
 * without a legend to decode it against" -- so the sentence rides with it
 * wherever there is room, and is the tooltip where there is not.
 *
 * OUT OF FIVE, ALWAYS. A bare 4 leaves the reader to guess the scale.
 *
 * HIS OVERRIDES ARE MARKED. The whole point of a manual grade is that it beats
 * the system's; a list that showed the two identically would hide the fact
 * that he had already made a call on this company.
 */

/** Tinted from the same palette the signal chips use, so the two agree. */
const TONE: Record<number, { color: string; bg: string }> = {
  5: { color: "#0b7a0b", bg: "#e2f6e2" },
  4: { color: "#9a4a1f", bg: "#fbe4d7" },
  3: { color: "#3d5a80", bg: "#e1e9f2" },
  2: { color: "#5b6577", bg: "#eceef2" },
  1: { color: "#6b7280", bg: "#f1f2f4" },
};

export interface Verdict {
  /** 1-5, his if he has given one. */
  n: number;
  /** What that rung means, in words. */
  sentence: string;
  /** True when this is his call rather than the system's. */
  mine: boolean;
}

export function verdictFor(company: Company, ownGrade: number | null | undefined): Verdict {
  if (ownGrade) {
    // RUNG_ORDER is best-first and the number counts the other way, so rung 5
    // is index 0. Same arithmetic the export uses; getting it backwards would
    // label his 5 with the sentence for a 1.
    const k = RUNG_ORDER[RUNG_ORDER.length - ownGrade];
    return { n: ownGrade, sentence: k ? DEFAULT_RULES[k] : "", mine: true };
  }
  return { n: rankFor(company), sentence: DEFAULT_RULES[rungFor(company)], mine: false };
}

export function ScorePill({
  verdict,
  size = "sm",
}: {
  verdict: Verdict;
  size?: "sm" | "md";
}) {
  const tone = TONE[verdict.n] ?? TONE[1];
  return (
    <span
      // The sentence, for the places too narrow to print it. A number with no
      // way at all to find out what it means is the thing this must not be.
      title={`${verdict.sentence}${verdict.mine ? " — your call" : " — what the system found"}`}
      className={`inline-flex shrink-0 items-baseline gap-0.5 rounded-full font-semibold leading-none ${
        size === "md" ? "px-2.5 py-1.5 text-sm" : "px-2 py-1 text-[11px]"
      }`}
      style={{ color: tone.color, background: tone.bg }}
    >
      <span className="tabular">{verdict.n}</span>
      <span className="text-[0.75em] font-normal opacity-70">/5</span>
      {verdict.mine && (
        <span className="ml-1 text-[0.75em] font-semibold uppercase tracking-wide opacity-80">
          you
        </span>
      )}
    </span>
  );
}
