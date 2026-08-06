"use client";

import { useEffect, useRef, useState } from "react";
import { useSearches, SearchFolder } from "@/lib/searches-store";
import { RadarIcon } from "./icons";

interface Props {
  searchId: string;
  query: string;
  onComplete: (folder: SearchFolder) => void;
  onError: (message: string) => void;
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

function currentActivity(folder: SearchFolder): string {
  const classified = folder.qualifiedCount + folder.verifyCount + folder.fitOnlyCount + folder.rejectedCount;
  if (folder.pagesFetched < folder.companiesScanned) {
    return `Fetching leadership pages — ${folder.pagesFetched}/${folder.companiesScanned}`;
  }
  if (classified < folder.companiesScanned) {
    return folder.mode === "signal"
      ? `Classifying — ${folder.qualifiedCount} qualified · ${folder.verifyCount} verify · ${folder.rejectedCount} rejected`
      : `Classifying — ${folder.qualifiedCount + folder.verifyCount + folder.fitOnlyCount} accepted (${folder.qualifiedCount + folder.verifyCount} with a signal) · ${folder.rejectedCount} rejected`;
  }
  return "Looking for more candidates…";
}

export function SearchProgress({ searchId, query, onComplete, onError }: Props) {
  const { fetchFolder } = useSearches();
  const [folder, setFolder] = useState<SearchFolder | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;

    async function poll() {
      while (!stopRef.current) {
        const f = await fetchFolder(searchId);
        if (!f) {
          onError("Search vanished — try again.");
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

        await new Promise((r) => setTimeout(r, 900));
      }
    }

    poll();
    return () => {
      stopRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId]);

  if (!folder) {
    return null;
  }

  const found = foundCount(folder);
  const pct = Math.min(100, Math.round((found / Math.max(folder.targetSignals, 1)) * 100));
  const unit = folder.mode === "signal" ? "signals" : "companies";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gh-navy-3/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gh-border bg-gh-surface p-7 shadow-2xl">
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
          <div className="mx-auto mt-3 h-2 max-w-[240px] overflow-hidden rounded-full bg-gh-surface-sunken">
            <div
              className="h-full rounded-full bg-gh-sky transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="mt-5 rounded-lg bg-gh-surface-sunken px-3 py-2.5 text-center">
          <p className="tabular text-xs font-medium text-gh-ink-secondary">{currentActivity(folder)}</p>
        </div>

        <p className="mt-3 text-center text-[11px] text-gh-ink-muted">
          {folder.companiesScanned} companies checked so far — kept results accumulate as
          rounds continue, nothing found so far gets thrown away.
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
