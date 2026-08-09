"use client";

import { useEffect, useRef, useState } from "react";
import { useSearches, SearchFolder } from "@/lib/searches-store";
import { RUN_CEILING_MS, REAP_GRACE_MS } from "@/lib/pipeline/reap";
import { RadarIcon } from "./icons";

interface Props {
  searchId: string;
  query: string;
  onComplete: (folder: SearchFolder) => void;
  onError: (message: string) => void;
  /** Close the dialog without stopping the server-side run. */
  onDismiss?: () => void;
}

// Round-based accumulator (see lib/pipeline/orchestrator.ts) — discover ->
// fetch -> classify repeats in batches until the target count is hit, so a
// fixed 4-step checklist doesn't fit. Instead: a live ratio toward the
// target, plus one status line for whatever the current round is doing.
//
// What counts as "found" depends on mode, same as the orchestrator's own
// countsTowardTarget(): 'signal' only counts qualified+verify (a plain
// ICP-fit company isn't the point of that mode); 'filter'/'hybrid' count
// fitOnly too, since that's most of what those modes actually accept. Get
// this wrong and a filter-mode run looks permanently stuck at 0% while it's
// successfully finding company after company in the background.
function foundCount(folder: SearchFolder): number {
  const signalFound = folder.qualifiedCount + folder.verifyCount;
  return folder.mode === "signal" ? signalFound : signalFound + folder.fitOnlyCount;
}

/**
 * Which of the three stages the run is in right now.
 *
 * The pipeline loops discover -> fetch -> classify in rounds, so this is not a
 * one-way march: it returns to "find" every time the candidate buffer empties.
 * Showing the CURRENT stage is what turns a spinner into something that is
 * visibly doing a specific thing, rather than a bar that might be stuck.
 */
type Stage = "find" | "read" | "judge";

function currentStage(folder: SearchFolder): Stage {
  const classified =
    folder.qualifiedCount + folder.verifyCount + folder.fitOnlyCount + folder.rejectedCount;
  if (folder.pagesFetched < folder.companiesScanned) return "read";
  if (classified < folder.companiesScanned) return "judge";
  return "find";
}

const STAGE_LABEL: Record<Stage, string> = {
  find: "Finding companies",
  read: "Reading their pages",
  judge: "Judging the signal",
};

function currentActivity(folder: SearchFolder): string {
  const classified = folder.qualifiedCount + folder.verifyCount + folder.fitOnlyCount + folder.rejectedCount;
  if (folder.pagesFetched < folder.companiesScanned) {
    return `${folder.pagesFetched} of ${folder.companiesScanned} pages read`;
  }
  if (classified < folder.companiesScanned) {
    // Counts what he is GETTING, not what is being thrown away. This used to
    // append "· 67 cut", which is the biggest number on a healthy run and made
    // a working search read as mostly failure. The companies-checked line
    // below already shows the work is progressing.
    //
    // Same plain wording as the folder card and the finished summary: how many
    // leads so far, and how many of those carry a signal — not the internal
    // qualified / verify vocabulary.
    const found =
      folder.qualifiedCount + folder.verifyCount + folder.fitOnlyCount;
    const withSignal = folder.qualifiedCount + folder.verifyCount;
    return withSignal > 0 && withSignal !== found
      ? `${found} found · ${withSignal} with signal`
      : `${found} lead${found === 1 ? "" : "s"} found so far`;
  }
  return "Looking for more to check…";
}

export function SearchProgress({ searchId, query, onComplete, onError, onDismiss }: Props) {
  const { fetchFolder } = useSearches();
  const [folder, setFolder] = useState<SearchFolder | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;

    async function poll() {
      while (!stopRef.current) {
        const f = await fetchFolder(searchId);
        if (!f) {
          onError("Search vanished. Try again.");
          return;
        }
        setFolder(f);

        if (f.status === "failed") {
          onError(f.errorMessage ?? "Search failed for an unknown reason.");
          return;
        }
        if (f.status === "complete") {
          onComplete(f);
          return;
        }

        // The run cannot outlive the server's function ceiling, so past it the
        // process is gone and this row will never change again on its own.
        // Polling it forever is what turned a killed run into a dialog frozen
        // at "16 of 20" with no way out. Stop and hand back what it found —
        // reapStaleRuns settles the row itself on the next dashboard load.
        if (Date.now() - new Date(f.createdAt).getTime() > RUN_CEILING_MS + REAP_GRACE_MS) {
          onComplete(f);
          return;
        }

        await new Promise((r) => setTimeout(r, 900));
      }
    }

    poll();
    return () => {
      stopRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId]);

  // Escape closes it. A modal whose only exit is one specific button is a
  // trap the moment that button is missing or scrolled out of reach, and
  // Escape is the first thing anyone tries.
  useEffect(() => {
    if (!onDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (!folder) {
    return null;
  }

  const found = foundCount(folder);
  const pct = Math.min(100, Math.round((found / Math.max(folder.targetSignals, 1)) * 100));
  const unit = folder.mode === "signal" ? "signals" : "companies";
  const stage = currentStage(folder);

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gh-navy-3/50 p-4 backdrop-blur-sm"
      // Clicking the backdrop closes it, the second thing anyone tries.
      // Guarded on the target being the backdrop itself so a click that starts
      // inside the card and drifts out does not dismiss.
      onClick={onDismiss ? (e) => { if (e.target === e.currentTarget) onDismiss(); } : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search in progress"
        className="scale-in my-auto w-full max-w-md rounded-2xl border border-gh-border bg-gh-surface p-7 shadow-2xl"
      >
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <span
            className="absolute rounded-full border border-gh-sky"
            style={{ width: 80, height: 80, opacity: 0.12, animation: "gh-ping 2.4s cubic-bezier(0,0,0.2,1) infinite 0.6s" }}
          />
          <span
            className="absolute rounded-full border border-gh-sky"
            style={{ width: 56, height: 56, opacity: 0.2, animation: "gh-ping 2.4s cubic-bezier(0,0,0.2,1) infinite 0.3s" }}
          />
          <span
            className="absolute rounded-full border-[1.5px] border-gh-sky"
            style={{ width: 38, height: 38, opacity: 0.35, animation: "gh-ping 2.4s cubic-bezier(0,0,0.2,1) infinite" }}
          />
          <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gh-navy text-white shadow-lg">
            <RadarIcon className="h-5 w-5" />
          </span>
        </div>

        <p className="mt-5 text-center text-xs font-medium text-gh-ink-muted">Searching for</p>
        <p className="mt-1 text-center text-sm font-semibold leading-snug text-gh-ink">
          &ldquo;{query}&rdquo;
        </p>

        <div className="mt-6">
          <div className="flex items-baseline justify-center gap-1.5">
            <span className="tabular font-display text-3xl font-semibold text-gh-ink">
              {found}
            </span>
            <span className="text-sm text-gh-ink-muted">/ {folder.targetSignals} {unit}</span>
          </div>
          <div className="mx-auto mt-3 max-w-[240px]">
            <div className="h-2 overflow-hidden rounded-full bg-gh-surface-sunken">
              <div
                className="h-full rounded-full bg-gh-sky transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            {/* The bar already encoded this in its width, but a width is not a
                number you can read out or compare to a minute ago. */}
            <p className="tabular mt-1.5 text-center text-[11px] font-semibold text-gh-ink-secondary">
              {pct}%
            </p>
          </div>
        </div>

        {/* WHICH of the three stages is running. Without it the bar can sit at
            the same percentage for a minute while real work happens, and the
            only honest reading is "possibly stuck". The pipeline loops, so this
            legitimately returns to Finding when the buffer empties. */}
        <div className="mt-5 flex items-center justify-center gap-1.5">
          {(["find", "read", "judge"] as Stage[]).map((s, i) => {
            const active = stage === s;
            return (
              <div key={s} className="flex items-center gap-1.5">
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors duration-300 ${
                    active
                      ? "bg-gh-navy text-white"
                      : "bg-gh-surface-sunken text-gh-ink-muted"
                  }`}
                >
                  {active && (
                    <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-gh-sky" />
                  )}
                  {STAGE_LABEL[s].split(" ")[0]}
                </span>
                {i < 2 && <span aria-hidden className="h-px w-2 bg-gh-border" />}
              </div>
            );
          })}
        </div>

        <div className="mt-3 rounded-lg bg-gh-surface-sunken px-3 py-2.5 text-center">
          <p className="text-xs font-semibold text-gh-ink">{STAGE_LABEL[stage]}</p>
          <p className="tabular mt-0.5 text-[11px] text-gh-ink-secondary">
            {currentActivity(folder)}
          </p>
        </div>

        <p className="mt-3 text-center text-[11px] text-gh-ink-muted">
          {folder.companiesScanned} checked. Nothing found is ever discarded.
        </p>

        {/* The run lives on the server (see `after()` in app/api/search/route.ts),
            not in this tab — closing the dialog, navigating away or quitting
            the browser does not stop it. Without a way out, this modal reads
            as "you must sit here and wait", which is both untrue and the
            reason a long search feels like wasted time. */}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="mt-4 w-full rounded-xl border border-gh-border bg-gh-surface-sunken py-2.5 text-xs font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink"
          >
            Let it run, I&rsquo;ll check back later
          </button>
        )}
        <p className="mt-2 text-center text-[11px] text-gh-ink-muted">
          Keeps running if you close this or leave the page.
        </p>
      </div>

      <style>{`
        @keyframes gh-ping {
          0% { transform: scale(0.7); opacity: 0.4; }
          80%, 100% { transform: scale(1.3); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
