"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSearches } from "@/lib/searches-store";
import { FolderCard } from "./FolderCard";
import { SearchProgress } from "./SearchProgress";
import { SearchIcon, ZapIcon } from "./icons";

const EXAMPLE_PROMPTS = [
  "Landscaping companies in Texas showing succession signals",
  "Family-owned home builders in North Carolina and Ohio",
  "Georgia landscaping companies where the founder is handing off",
];

export function SearchHome() {
  const router = useRouter();
  const { folders, loading, createSearch } = useSearches();
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState<{ id: string; query: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  async function startSearch(q: string) {
    const text = q.trim();
    if (!text || starting) return;
    setError("");
    setStarting(true);
    try {
      const { id } = await createSearch(text);
      setRunning({ id, query: text });
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
    setQuery("");
    router.push(`/dashboard/lists/${id}`);
  }

  function handleError(message: string) {
    setRunning(null);
    setError(message);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="pt-6 text-center sm:pt-14">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gh-navy text-white">
          <ZapIcon className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold text-gh-ink sm:text-3xl">
          Who are you looking for?
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-gh-ink-secondary">
          Describe the family businesses you want to find — an industry, a state, the
          signal you're after. Signal Radar runs the search and hands back a
          verified, evidence-backed list.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          startSearch(query);
        }}
        className="mx-auto mt-6 max-w-2xl"
      >
        <div className="flex items-center gap-2 rounded-2xl border border-gh-border bg-gh-surface p-2 shadow-sm focus-within:border-gh-sky focus-within:ring-2 focus-within:ring-gh-sky/20">
          <SearchIcon className="ml-2 h-4.5 w-4.5 shrink-0 text-gh-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="text"
            placeholder="e.g. Landscaping companies in Texas showing succession signals"
            className="flex-1 bg-transparent py-2 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={!query.trim() || starting}
            className="shrink-0 rounded-xl bg-gh-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-40"
          >
            {starting ? "Starting…" : "Search"}
          </button>
        </div>

        {error && <p className="mt-2 text-center text-xs font-medium text-gh-critical">{error}</p>}

        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => startSearch(prompt)}
              className="rounded-full border border-gh-border bg-gh-surface px-3 py-1.5 text-xs font-medium text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink"
            >
              {prompt}
            </button>
          ))}
        </div>
      </form>

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
          query={running.query}
          onComplete={handleComplete}
          onError={handleError}
        />
      )}
    </div>
  );
}
