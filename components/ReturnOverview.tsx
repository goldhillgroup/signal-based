"use client";

import { useState } from "react";
import { enrichScopesFor } from "@/lib/enrich-scopes";
import { EnrichScopeDialog } from "./EnrichScopeDialog";
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
  const { folders, startEnrichment, fetchCompanies } = useSearches();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // THIS BUTTON SPENT MONEY ON ONE CLICK, AND ON THE WRONG THINGS.
  //
  // It called startEnrichment(id) with no scope and no confirmation. An absent
  // scope is read by the API as "signals", so on a folder of 24 leads with 2
  // pairs it silently bought two addresses and looked finished — no choice
  // offered, no way from this screen to reach the other 22, and no yes/no
  // before the vendor was billed. The folder page and the Enrichment page had
  // both asked first for a long time; this one, the most prominent of the
  // three, did not.
  const [choosing, setChoosing] = useState<{
    id: string;
    label: string;
    scopes: ReturnType<typeof enrichScopesFor>;
  } | null>(null);

  const running = folders.filter((f) => f.status === "running");
  const ready = folders.filter(
    (f) =>
      f.status === "complete" &&
      f.enrichmentStatus === "idle" &&
      leadCount(f) > 0
  );

  if (running.length === 0 && ready.length === 0) return null;

  /** Load the folder's companies so the three scopes carry real counts and
   *  real ids — the widest one reaches rejected companies, which the server
   *  can only be told about by id. */
  async function openChooser(id: string, label: string) {
    setBusy(id);
    setError("");
    try {
      const companies = await fetchCompanies(id);
      setChoosing({ id, label, scopes: enrichScopesFor(companies) });
    } catch (e) {
      setError((e as Error).message || "Could not read that list.");
    } finally {
      setBusy(null);
    }
  }

  async function enrich(id: string, ids: string[]) {
    setChoosing(null);
    setBusy(id);
    setError("");
    try {
      await startEnrichment(id, undefined, ids);
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
                onClick={() => openChooser(f.id, f.label)}
                disabled={busy === f.id}
                className="shrink-0 rounded-lg bg-gh-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === f.id ? "Starting…" : "Find personal emails"}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] font-medium text-gh-critical">{error}</p>}

      {/* Three scopes and a yes/no, in one step. The same three groups the
          folder page shows as tabs, so what you can enrich matches what you
          would be looking at. Each carries its own price because they differ by
          an order of magnitude — on a real folder: $0.11, $0.84, $1.85. */}
      {/* Keyed by folder so opening a different list starts fresh. A
          useEffect resetting state on open is the other way to do this and
          it is a synchronous setState inside an effect — lint rejects it,
          and rightly: remounting is the React answer. */}
      <EnrichScopeDialog
        key={choosing?.id ?? "none"}
        open={choosing !== null}
        folderLabel={choosing?.label ?? ""}
        scopes={choosing?.scopes ?? []}
        onPick={(ids) => choosing && enrich(choosing.id, ids)}
        onCancel={() => setChoosing(null)}
      />
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
