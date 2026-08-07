"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSearches } from "@/lib/searches-store";
import { US_STATES, AGREED_STATES, stateNameFor } from "@/lib/pipeline/us-states";
import { INDUSTRY_META } from "@/lib/signal-meta";
import { applyAnswer, bandLabel, labelFor, type IntakeResult } from "@/lib/pipeline/intake-types";
import type { Industry, SearchMode } from "@/lib/supabase/types";
import { FolderCard } from "./FolderCard";
import { ReturnOverview } from "./ReturnOverview";
import { SearchProgress } from "./SearchProgress";
import { ZapIcon } from "./icons";

const TARGET_OPTIONS = [10, 20, 50, 100];
const REFINEMENT_EXAMPLES = [
  "succession signals",
  "founder retiring",
  "second generation taking over",
];

// Shown under the ask box. Deliberately span the shapes the old regex parser
// silently mishandled — a multi-state request, a region, a metro — so the
// examples double as a demonstration that those now work.
const ASK_EXAMPLES = [
  "Landscaping companies in Texas and Oklahoma, $3-15M",
  "Family-owned home builders around the Bay Area",
  "Lawn care firms in the Southeast, 10 leads",
];

const MODE_META: Record<SearchMode, { label: string; description: string; targetLabel: string }> = {
  hybrid: {
    label: "Hybrid",
    description: "Every company that fits — succession signals ranked first, everyone else right behind.",
    targetLabel: "Companies to find:",
  },
  signal: {
    label: "Signal only",
    description: "Only companies showing a real founder-to-next-gen succession signal.",
    targetLabel: "Signals to find:",
  },
  filter: {
    label: "Just filter",
    description: "Every company in the vertical + state that fits the ICP — no signal required at all.",
    targetLabel: "Companies to find:",
  },
};
const MODE_ORDER: SearchMode[] = ["hybrid", "signal", "filter"];

// Step 01 of the stated method names a $3-15M band. Kept as the DEFAULT
// rather than a hard rule — "no limit" is one click away, and the estimate
// itself comes from soft textual proxies (crew size, years in business), not
// real financials, so it should never feel like a locked constraint.
const BAND_OPTIONS: { label: string; min: number | null; max: number | null }[] = [
  { label: "$3-15M (baseline)", min: 3, max: 15 },
  { label: "Under $3M", min: null, max: 3 },
  { label: "$15M+", min: 15, max: null },
  { label: "No limit", min: null, max: null },
];

export function SearchHome() {
  const router = useRouter();
  const { folders, loading, createSearch } = useSearches();

  // ── Ask-first path ──────────────────────────────────────────────────────
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [intake, setIntake] = useState<IntakeResult | null>(null);
  // Questions he has already resolved (answered OR skipped) — both count, so
  // skipping visibly settles a question instead of leaving it nagging.
  const [resolved, setResolved] = useState<string[]>([]);

  // ── Manual path (unchanged, now opt-in) ─────────────────────────────────
  const [showManual, setShowManual] = useState(false);
  const [industry, setIndustry] = useState<Industry | null>(null);
  const [state, setState] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [refinement, setRefinement] = useState("");
  const [target, setTarget] = useState(20);
  const [bandIdx, setBandIdx] = useState(0); // defaults to the $3-15M baseline

  const [running, setRunning] = useState<{ id: string; label: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const canSearch = industry !== null && state !== "" && !starting;
  const pending = intake?.questions.filter((q) => !resolved.includes(q.field)) ?? [];

  async function parse() {
    if (!text.trim() || parsing) return;
    setError("");
    setParsing(true);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not read that request.");
      setIntake(body as IntakeResult);
      setResolved([]);
    } catch (e) {
      setError((e as Error).message || "Could not read that request.");
    } finally {
      setParsing(false);
    }
  }

  function answer(field: IntakeResult["questions"][number]["field"], value: string) {
    if (!intake) return;
    setIntake(applyAnswer(intake, field, value));
    setResolved((r) => [...r, field]);
  }

  async function startFromIntake() {
    if (!intake || starting) return;
    setError("");
    setStarting(true);
    try {
      const { id, label } = await createSearch({
        industry: intake.industry,
        states: intake.states,
        targetSignals: intake.targetSignals,
        mode: intake.mode,
        revenueMinMusd: intake.revenueMinMusd,
        revenueMaxMusd: intake.revenueMaxMusd,
      });
      setRunning({ id, label });
    } catch (e) {
      setError((e as Error).message || "Could not start that search.");
    } finally {
      setStarting(false);
    }
  }

  async function startSearch() {
    if (!industry || !state || starting) return;
    setError("");
    setStarting(true);
    try {
      const band = BAND_OPTIONS[bandIdx];
      const { id, label } = await createSearch({
        industry,
        state,
        refinement,
        targetSignals: target,
        mode,
        revenueMinMusd: band.min,
        revenueMaxMusd: band.max,
      });
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

  const chip =
    "rounded-full border border-gh-border bg-gh-surface px-2.5 py-1 text-[11px] font-medium text-gh-ink-secondary";

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
          Describe it in your own words. Signal Radar keeps discovering and
          classifying real local businesses until it hits your target, or runs
          out of companies to check.
        </p>
      </div>

      {/* ── Ask box ──────────────────────────────────────────────────────── */}
      <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-gh-border bg-gh-surface p-5 shadow-sm">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) parse();
          }}
          rows={3}
          placeholder="e.g. Family-owned landscaping companies in Texas and Oklahoma doing $3-15M…"
          className="w-full resize-none rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ASK_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="rounded-full border border-gh-border bg-gh-surface px-2.5 py-1 text-[11px] font-medium text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink"
            >
              {ex}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={parse}
          disabled={!text.trim() || parsing}
          className="mt-4 w-full rounded-xl bg-gh-navy py-3 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {parsing ? "Reading that…" : "Continue"}
        </button>

        {/* ── What it understood + at most 3 questions ─────────────────── */}
        {intake && (
          <div className="mt-4 rounded-xl border border-gh-border bg-gh-surface-sunken p-4">
            <p className="text-xs font-semibold text-gh-ink">Here&rsquo;s what I understood</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={chip}>{labelFor(intake.industry)}</span>
              <span className={chip}>
                {intake.states.length > 3
                  ? `${intake.states.length} states`
                  : intake.states.map(stateNameFor).join(", ")}
              </span>
              <span className={chip}>{bandLabel(intake.revenueMinMusd, intake.revenueMaxMusd)}</span>
              <span className={chip}>{MODE_META[intake.mode].label}</span>
              <span className={chip}>{intake.targetSignals} wanted</span>
            </div>
            {intake.states.length > 3 && (
              <p className="mt-1.5 text-[11px] text-gh-ink-muted">
                {intake.states.map(stateNameFor).join(", ")}
              </p>
            )}

            {pending.length > 0 && (
              <div className="mt-4 space-y-3">
                {pending.map((q) => (
                  <div key={q.field}>
                    <p className="mb-1.5 text-xs font-medium text-gh-ink-secondary">{q.question}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {q.options.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => answer(q.field, o.value)}
                          className="rounded-full border border-gh-border bg-gh-surface px-3 py-1 text-xs font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink"
                        >
                          {o.label}
                        </button>
                      ))}
                      {/* Skipping is a first-class path, not a dead end — the
                          stated default runs and stays visible below. */}
                      <button
                        type="button"
                        onClick={() => setResolved((r) => [...r, q.field])}
                        className="rounded-full px-3 py-1 text-xs font-medium text-gh-ink-muted underline underline-offset-2 hover:text-gh-ink"
                      >
                        Skip — {q.skipLabel.toLowerCase()}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {intake.assumptions.length > 0 && (
              <p className="mt-3 text-[11px] leading-relaxed text-gh-ink-muted">
                Filling in: {intake.assumptions.join(" · ")}
              </p>
            )}

            <button
              type="button"
              onClick={startFromIntake}
              disabled={starting}
              className="mt-4 w-full rounded-xl bg-gh-navy py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting
                ? "Starting…"
                : pending.length > 0
                  ? `Start anyway (${pending.length} unanswered)`
                  : "Start search"}
            </button>
          </div>
        )}

        {error && <p className="mt-2 text-center text-xs font-medium text-gh-critical">{error}</p>}

        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="mt-3 w-full text-center text-[11px] font-medium text-gh-ink-muted underline underline-offset-2 hover:text-gh-ink"
        >
          {showManual ? "Hide manual setup" : "Or set it up manually"}
        </button>
      </div>

      {/* ── Manual setup (the original structured form) ──────────────────── */}
      {showManual && (
        <div className="mx-auto mt-4 max-w-2xl rounded-2xl border border-gh-border bg-gh-surface p-5 shadow-sm">
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">Mode</label>
            <div className="grid grid-cols-3 gap-2">
              {MODE_ORDER.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  className={`rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                    mode === key
                      ? "border-gh-navy bg-gh-navy text-white"
                      : "border-gh-border bg-gh-surface-sunken text-gh-ink-secondary hover:border-gh-sky/40"
                  }`}
                >
                  {MODE_META[key].label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-gh-ink-muted">{MODE_META[mode].description}</p>
          </div>

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
                <optgroup label="Agreed states">
                  {US_STATES.filter((s) => AGREED_STATES.includes(s.code)).map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other states">
                  {US_STATES.filter((s) => !AGREED_STATES.includes(s.code)).map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="refinement" className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
              Signal focus <span className="font-normal text-gh-ink-muted">(optional)</span>
            </label>
            {/* Deliberately does NOT steer discovery — only nudges what
                classification pays attention to within the vertical + state
                above. Letting free text pick which companies get found is how a
                search drifts off the agreed vertical; the two required
                structured inputs exist to make that impossible. */}
            <p className="mb-1.5 text-[11px] leading-relaxed text-gh-ink-muted">
              A hint for what to look for within {INDUSTRY_META[industry ?? "landscaping"].label.toLowerCase()} in your chosen
              state — it never changes which companies get searched.
            </p>
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
            <span className="text-xs font-medium text-gh-ink-muted">Revenue band:</span>
            {BAND_OPTIONS.map((b, i) => (
              <button
                key={b.label}
                type="button"
                onClick={() => setBandIdx(i)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  bandIdx === i
                    ? "bg-gh-navy text-white"
                    : "border border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gh-ink-muted">{MODE_META[mode].targetLabel}</span>
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
        </div>
      )}

      {/* Surfaces anything that finished while he was away, plus the one
          action left on it. Renders nothing when there's nothing to say. */}
      <ReturnOverview />

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
          onDismiss={() => setRunning(null)}
        />
      )}
    </div>
  );
}
