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
/**
 * How many automatic passes a single press may take.
 *
 * 6 x ~57 companies covers the 240-company absolute scan ceiling, so the
 * server's own limits are always the ones that actually stop it. This exists
 * only so a bug in those limits cannot spend without bound.
 */
const MAX_AUTO_PASSES = 6;

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
  /**
   * Passes taken so far. A ref because the polling loop closes over it, and a
   * mirrored state value because the dialog renders it.
   */
  const passRef = useRef(1);
  const [pass, setPass] = useState(1);
  // Initialised to 0, not Date.now(): calling an impure function during render
  // is exactly the unstable-across-re-renders trap React warns about. The
  // effect below stamps it before the first poll, which is the only moment it
  // needs to be right.
  const passStartedRef = useRef(0);
  const [stopReason, setStopReason] = useState<string | null>(null);

  useEffect(() => {
    // A LOCAL token, not the shared ref. React re-invokes effects — guaranteed
    // in development's StrictMode, and possible in production on a remount —
    // and the old code's cleanup set a SHARED flag that the next effect
    // promptly reset to false, resurrecting the loop it had just stopped. Two
    // live polling loops then each fired their own continuation, which is how
    // two passes came to run concurrently and corrupt the counts.
    //
    // Captured per effect, so a cancelled run can never be revived by its
    // successor. The server's atomic claim is the real guard; this stops the
    // duplicate request being made at all.
    const alive = { current: true };
    stopRef.current = false;
    passStartedRef.current = Date.now();

    async function poll() {
      while (alive.current && !stopRef.current) {
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
          // ── AUTOMATIC CONTINUATION ──────────────────────────────────────
          //
          // A pass reads about 57 companies before the server stops it, and a
          // target of 100 needs 240. So a large target is several passes, and
          // making the user notice that and press a button again is asking
          // them to do the scheduler's job — they asked for 100, not for
          // "as many as fit in five minutes".
          //
          // The server decides whether another pass is allowed; this only
          // asks. /continue refuses when the target is met, the pool is dry,
          // or the scan ceiling is reached, so the loop terminates on the
          // server's terms rather than the browser's.
          //
          // MAX_AUTO_PASSES is a second, independent brake. The server-side
          // reasons should always fire first; this is the one that holds if a
          // bug means they never do, because an unbounded continuation loop
          // is the failure mode that turns a $0.70 search into a bill.
          if (foundCount(f) < f.targetSignals && passRef.current < MAX_AUTO_PASSES) {
            passRef.current += 1;
            setPass(passRef.current);
            const res = await fetch(`/api/search/${searchId}/continue`, { method: "POST" });
            if (!alive.current) return;
            const body = await res.json().catch(() => ({}));
            if (res.ok && body?.continued) {
              // Restart the abandon timer. It measures ONE pass against the
              // function ceiling; leaving it at the first pass's start would
              // give up part-way through pass two of five on a search that is
              // working perfectly.
              passStartedRef.current = Date.now();
              // Keep polling: the row is 'running' again and the counts carry
              // on from where they were, because the orchestrator seeds them
              // from the companies already in the folder.
              await new Promise((r) => setTimeout(r, 1200));
              continue;
            }
            // Refused, and the reason is the honest end of the search.
            if (body?.reason) setStopReason(String(body.reason));
          }
          onComplete(f);
          return;
        }

        // The run cannot outlive the server's function ceiling, so past it the
        // process is gone and this row will never change again on its own.
        // Polling it forever is what turned a killed run into a dialog frozen
        // at "16 of 20" with no way out. Stop and hand back what it found —
        // reapStaleRuns settles the row itself on the next dashboard load.
        //
        // Dated from the CURRENT PASS, not the folder: with continuation a
        // healthy search legitimately lives far longer than one ceiling, and
        // measuring from createdAt would abandon the dialog mid-way through
        // pass two of five.
        if (Date.now() - passStartedRef.current > RUN_CEILING_MS + REAP_GRACE_MS) {
          onComplete(f);
          return;
        }

        await new Promise((r) => setTimeout(r, 900));
      }
    }

    poll();
    return () => {
      alive.current = false;
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
            className="ping-ring absolute rounded-full border border-gh-sky"
            style={{ width: 80, height: 80, "--gh-ring-opacity": 0.12, "--gh-ring-delay": "600ms" } as React.CSSProperties}
          />
          <span
            className="ping-ring absolute rounded-full border border-gh-sky"
            style={{ width: 56, height: 56, "--gh-ring-opacity": 0.2, "--gh-ring-delay": "300ms" } as React.CSSProperties}
          />
          <span
            className="ping-ring absolute rounded-full border-[1.5px] border-gh-sky"
            style={{ width: 38, height: 38, "--gh-ring-opacity": 0.35 } as React.CSSProperties}
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

        {/* Say that it is on pass two, rather than letting the bar appear to
            stall while the next one starts. A big target legitimately takes
            several passes and silence about that reads as a fault. */}
        {pass > 1 && (
          <p className="fade-in mt-1 text-center text-[11px] text-gh-ink-secondary">
            Pass {pass} — the server stops each one at{" "}
            {Math.round(RUN_CEILING_MS / 60000)} minutes, so a large target
            continues automatically.
          </p>
        )}
        {stopReason && (
          <p className="fade-in mt-1 text-center text-[11px] text-gh-ink-muted">{stopReason}</p>
        )}

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
