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

type StepKey = "discover" | "fetch" | "classify" | "contacts";

const STEP_LABELS: Record<StepKey, string> = {
  discover: "Discovering candidate companies",
  fetch: "Fetching leadership pages",
  classify: "Classifying signals",
  contacts: "Finding & verifying contacts",
};
const STEP_ORDER: StepKey[] = ["discover", "fetch", "classify", "contacts"];

// Real pipeline runs each candidate through classify -> contact -> verify in
// one pass (see lib/pipeline/orchestrator.ts), so "contacts" naturally trails
// "classify" per-company rather than waiting for it to fully finish first —
// this derives a reasonable current-step-for-display from the same
// cumulative counters the backend writes onto the `searches` row.
function deriveStep(folder: SearchFolder): { active: StepKey; done: Set<StepKey> } {
  const done = new Set<StepKey>();
  const classified = folder.qualifiedCount + folder.verifyCount + folder.rejectedCount;

  if (folder.candidatesFound === 0) return { active: "discover", done };
  done.add("discover");

  if (folder.pagesFetched < folder.companiesScanned) return { active: "fetch", done };
  done.add("fetch");

  if (classified < folder.companiesScanned) return { active: "classify", done };
  done.add("classify");

  return { active: "contacts", done };
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

  const { active, done } = deriveStep(folder);

  function stepDetail(key: StepKey): string {
    if (!folder) return "";
    switch (key) {
      case "discover":
        return `${folder.candidatesFound} candidates found`;
      case "fetch":
        return `${folder.pagesFetched}/${folder.companiesScanned} pages fetched`;
      case "classify":
        return `${folder.qualifiedCount} qualified · ${folder.verifyCount} verify · ${folder.rejectedCount} rejected`;
      case "contacts":
        return `${folder.contactsFound} found · ${folder.contactsVerified} verified`;
    }
  }

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

        <div className="mt-6 space-y-1">
          {STEP_ORDER.map((key) => {
            const isDone = done.has(key);
            const isActive = active === key && !isDone;
            return (
              <div
                key={key}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  isActive ? "bg-gh-surface-sunken" : ""
                }`}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: isDone ? "#0b7a0b" : isActive ? "var(--gh-sky)" : "var(--gh-surface-sunken)",
                  }}
                >
                  {isDone ? (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
                      <path d="M2.5 6l2.2 2.2L9.5 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : isActive ? (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-semibold ${
                      isDone || isActive ? "text-gh-ink" : "text-gh-ink-muted"
                    }`}
                  >
                    {STEP_LABELS[key]}
                  </p>
                  {(isDone || isActive) && (
                    <p className="tabular text-[11px] text-gh-ink-muted">{stepDetail(key)}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
