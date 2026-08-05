"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSearches } from "@/lib/searches-store";
import { US_STATES } from "@/lib/pipeline/us-states";
import { INDUSTRY_META } from "@/lib/signal-meta";
import type { Industry } from "@/lib/supabase/types";
import { FolderCard } from "./FolderCard";
import { SearchProgress } from "./SearchProgress";
import { ZapIcon } from "./icons";

const TARGET_OPTIONS = [10, 20, 50, 100];
const REFINEMENT_EXAMPLES = [
  "succession signals",
  "founder retiring",
  "second generation taking over",
];

export function SearchHome() {
  const router = useRouter();
  const { folders, loading, createSearch } = useSearches();
  const [industry, setIndustry] = useState<Industry | null>(null);
  const [state, setState] = useState("");
  const [refinement, setRefinement] = useState("");
  const [target, setTarget] = useState(20);
  const [running, setRunning] = useState<{ id: string; label: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const canSearch = industry !== null && state !== "" && !starting;

  async function startSearch() {
    if (!industry || !state || starting) return;
    setError("");
    setStarting(true);
    try {
      const { id, label } = await createSearch({ industry, state, refinement, targetSignals: target });
      setRunning({ id, label });
    } catch (e) {
      setError((e as Error).message || "Could not start that search.");
    } finally {
      setStarting(false);
    }
  }

  function handleComplete() {
    if (!running) return;
    const id = running.id;
    setRunning(null);
    setRefinement("");
    router.push(`/dashboard/lists/${id}`);
  }

  function handleError(message: string) {
    setRunning(null);
    setError(message);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="pt-6 text-center sm:pt-10">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gh-navy text-white">
          <ZapIcon className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold text-gh-ink sm:text-3xl">
          Who are you looking for?
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-gh-ink-secondary">
          One vertical, one state at a time — Signal Radar keeps discovering and
          classifying real local businesses until it has that many qualified
          signals, or runs out of companies to check.
        </p>
      </div>

      <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-gh-border bg-gh-surface p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
              Vertical
            </label>
            <div className="flex gap-2">
              {(["landscaping", "home_builder"] as Industry[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIndustry(key)}
                  className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                    industry === key
                      ? "border-gh-navy bg-gh-navy text-white"
                      : "border-gh-border bg-gh-surface-sunken text-gh-ink-secondary hover:border-gh-sky/40"
                  }`}
                >
                  {INDUSTRY_META[key].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="state" className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
              State
            </label>
            <select
              id="state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
            >
              <option value="">Choose a state…</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="refinement" className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
            Signal focus <span className="font-normal text-gh-ink-muted">(optional)</span>
          </label>
          <input
            id="refinement"
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
            type="text"
            placeholder="e.g. succession signals, founder retiring…"
            className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REFINEMENT_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setRefinement(ex)}
                className="rounded-full border border-gh-border bg-gh-surface px-2.5 py-1 text-[11px] font-medium text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gh-ink-muted">Signals to find:</span>
          {TARGET_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTarget(n)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                target === n
                  ? "bg-gh-navy text-white"
                  : "border border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {target >= 50 && (
          <p className="mt-1.5 text-[11px] text-gh-ink-muted">
            Larger targets take longer — the pipeline keeps discovering and
            classifying new companies in rounds until it gets close.
          </p>
        )}

        <button
          type="button"
          onClick={startSearch}
          disabled={!canSearch}
          className="mt-5 w-full rounded-xl bg-gh-navy py-3 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {starting ? "Starting…" : "Search"}
        </button>
        {error && <p className="mt-2 text-center text-xs font-medium text-gh-critical">{error}</p>}
      </div>

      <div className="mt-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-gh-ink">Your lists</h2>
          <p className="text-xs text-gh-ink-muted">
            {loading ? "Loading…" : `${folders.length} search${folders.length === 1 ? "" : "es"}`}
          </p>
        </div>
        {!loading && folders.length === 0 && (
          <p className="rounded-xl border border-dashed border-gh-border bg-gh-surface p-8 text-center text-sm text-gh-ink-muted">
            No searches yet — run your first one above.
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => (
            <FolderCard key={folder.id} folder={folder} />
          ))}
        </div>
      </div>

      {running && (
        <SearchProgress
          searchId={running.id}
          query={running.label}
          onComplete={handleComplete}
          onError={handleError}
        />
      )}
    </div>
  );
}
