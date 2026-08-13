import type { SearchMode } from "../supabase/types";

/**
 * What counts toward a search's target — ONE definition, used by the pipeline
 * that decides when to stop and by the dialog that reports progress.
 *
 * They were separate, and they drifted the moment one of them changed. The
 * pipeline was corrected so hybrid counts founder-and-successor PAIRS (a run
 * was filling its target with fit-only companies and stopping before it found a
 * single pair — the one thing the product exists for). The progress dialog kept
 * its own copy, which still added fit-only rows in.
 *
 * A live run showed exactly what that costs. Read 60, 2 pairs, 13 fit-only:
 *
 *   pipeline:  2 of 8   -> keep going, four more passes to run
 *   dialog:   15 of 8   -> capped to "8 / 8", 100%, done
 *
 * So the dialog announced a finished search while the run was a quarter of the
 * way through, and — worse — the auto-continuation is gated on the DIALOG's
 * number, so the next pass never fired. A run that legitimately needed four
 * more was told it was complete, and stopped.
 *
 * Nothing failed. No error was logged. The bar just filled up and everything
 * went quiet, which is the hardest kind of bug to notice and the reason this
 * lives in one file that both sides import.
 *
 * Client-safe on purpose: the dialog is a Client Component, so this must never
 * import from lib/supabase/server or anything touching node:async_hooks.
 */
export interface TargetCounts {
  qualified: number;
  verify: number;
  fitOnly: number;
}

export function countsTowardTarget(mode: SearchMode, c: TargetCounts): number {
  // 'filter' asks for companies that fit and never claimed to look for a
  // signal, so every accepted company counts. 'signal' and 'hybrid' are both
  // asking for pairs; hybrid keeps the fits it passes on the way as a
  // by-product, but they are not what was asked for.
  return mode === "filter" ? c.qualified + c.verify + c.fitOnly : c.qualified + c.verify;
}

/** The unit to print beside the number, so the label matches what is counted. */
export function targetUnit(mode: SearchMode, n: number): string {
  if (mode === "filter") return n === 1 ? "company" : "companies";
  return n === 1 ? "pair" : "pairs";
}
