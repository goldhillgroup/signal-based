"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearches, type SearchFolder } from "@/lib/searches-store";
import { RadarIcon } from "./icons";

/**
 * What he sees when he comes back.
 *
 * Searches keep running server-side after the tab closes, which is only
 * useful if returning surfaces the result. Without this, a run that finished
 * overnight is indistinguishable from one that never happened — the work is
 * done and sitting in the database, but he has to go hunting through folders
 * to notice.
 *
 * Two things earn a place here, and nothing else:
 *   - still running  -> "it didn't die while you were gone"
 *   - done, not yet enriched -> the one action left worth taking
 *
 * Enrichment stays a deliberate click. It is the only step that bills per
 * PERSON rather than per company, so it must never fire as a side effect of
 * a search finishing.
 */
export function ReturnOverview() {
  const { folders, startEnrichment } = useSearches();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const running = folders.filter((f) => f.status === "running");
  const ready = folders.filter(
    (f) =>
      f.status === "complete" &&
      f.enrichmentStatus === "idle" &&
      leadCount(f) > 0
  );

  if (running.length === 0 && ready.length === 0) return null;

  async function enrich(id: string) {
    setBusy(id);
    setError("");
    try {
      await startEnrichment(id);
    } catch (e) {
      setError((e as Error).message || "Could not start enrichment.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-gh-border bg-gh-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gh-navy text-white">
          <RadarIcon className="h-3.5 w-3.5" />
        </span>
        <h2 className="font-display text-sm font-semibold text-gh-ink">
          {running.length > 0 ? "Still working" : "Ready for you"}
        </h2>
      </div>

      {running.length > 0 && (
        <div className="mt-3 space-y-2">
          {running.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-gh-surface-sunken px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-gh-ink">{f.label}</p>
                <p className="tabular mt-0.5 text-[11px] text-gh-ink-muted">
                  {leadCount(f)}/{f.targetSignals} found · {f.companiesScanned} checked
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-gh-sky/10 px-2.5 py-1 text-[11px] font-semibold text-gh-sky">
                running
              </span>
            </div>
          ))}
        </div>
      )}

      {ready.length > 0 && (
        <div className="mt-3 space-y-2">
          {ready.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-gh-surface-sunken px-3 py-2.5"
            >
              <div className="min-w-0">
                <Link
                  href={`/dashboard/lists/${f.id}`}
                  className="block truncate text-xs font-semibold text-gh-ink hover:underline"
                >
                  {f.label}
                </Link>
                <p className="tabular mt-0.5 text-[11px] text-gh-ink-muted">
                  {summarize(f)}
                </p>
                {/* A degraded run still completes and still shows a count.
                    Without this line that count reads as "this is what exists
                    out there", when really a channel never looked. */}
                {f.warnings && (
                  <p className="mt-1 text-[11px] leading-relaxed text-gh-ink-secondary">
                    ⚠ {f.warnings}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => enrich(f.id)}
                disabled={busy === f.id}
                className="shrink-0 rounded-lg bg-gh-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === f.id ? "Starting…" : "Find emails"}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] font-medium text-gh-critical">{error}</p>}
    </div>
  );
}

/**
 * Mirrors FolderCard's definition so the two never disagree: in 'signal' mode
 * only signal-bearing companies count, otherwise every ICP fit does.
 */
function leadCount(f: SearchFolder): number {
  return f.mode === "signal"
    ? f.qualifiedCount + f.verifyCount
    : f.qualifiedCount + f.verifyCount + f.fitOnlyCount;
}

function summarize(f: SearchFolder): string {
  // Same plain two-number story as the folder card: how many leads, and how
  // many of them carry a signal — not the old qualified / verify / ICP-fit
  // split.
  const leads = f.qualifiedCount + f.verifyCount + f.fitOnlyCount;
  const withSignal = f.qualifiedCount + f.verifyCount;
  const parts = [`${leads} lead${leads === 1 ? "" : "s"} found`];
  if (withSignal > 0) parts.push(`${withSignal} with signal`);
  parts.push(`${f.companiesScanned} checked`);
  // The honest footnote: a short result can mean "nothing left out there" or
  // "we ran out of runway", and those are very different facts.
  if (f.candidatesPoolExhausted) parts.push("pool exhausted");
  return parts.join(" · ");
}
