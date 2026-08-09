"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSearches } from "@/lib/searches-store";
import { AGREED_STATES, NATIONWIDE, stateNameFor } from "@/lib/pipeline/us-states";
import { WhatCountsAsSignal } from "./WhatCountsAsSignal";
import { INDUSTRY_META } from "@/lib/signal-meta";
import { applyAnswer, bandLabel, labelFor, type IntakeResult } from "@/lib/pipeline/intake-types";
import type { Industry, SearchMode } from "@/lib/supabase/types";
import { FolderCard } from "./FolderCard";
import { ReturnOverview } from "./ReturnOverview";
import { SearchProgress } from "./SearchProgress";
import { StatePicker } from "./StatePicker";
import { BuildingIcon, CheckIcon, SearchIcon, UsersIcon, ZapIcon } from "./icons";

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
    description: "Every company that fits, succession signals ranked first, everyone else right behind.",
    targetLabel: "Companies to find:",
  },
  signal: {
    label: "Signal only",
    description: "Only companies showing a real founder-to-next-gen succession signal.",
    targetLabel: "Signals to find:",
  },
  filter: {
    label: "Just filter",
    description: "Every company in the vertical + state that fits the ICP, no signal required at all.",
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
  // OPEN by default. This shipped collapsed, with a free-text box as the front
  // door and the structured form behind "Or set it up manually" — which had it
  // backwards. The form is deterministic: four controls, no ambiguity, no
  // parse. The text box costs an extra model call and can misread a request,
  // and it asks someone who is not a prompt engineer to phrase one. It is a
  // shortcut for people who already know what they want, which is what it is
  // now — kept, and second.
  const [showManual, setShowManual] = useState(true);
  const [industry, setIndustry] = useState<Industry | null>(null);
  // Defaults to all four agreed states — the signed scope, and the most likely
  // thing to want. It is not more expensive than picking one: the target
  // (companies to find) is what bounds cost, while locationForRound() rotates
  // state-by-state per round, so four states spread the SAME number of rounds
  // across more ground instead of adding rounds.
  const [states, setStates] = useState<string[]>([...AGREED_STATES]);
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [refinement, setRefinement] = useState("");
  const [target, setTarget] = useState(20);
  const [bandIdx, setBandIdx] = useState(0); // defaults to the $3-15M baseline

  const [running, setRunning] = useState<{ id: string; label: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // A nationwide search carries the sentinel "US" rather than a list, so
  // "something is selected" is the real precondition, not "a named state is".
  const canSearch = industry !== null && states.length > 0 && !starting;
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
    if (!industry || states.length === 0 || starting) return;
    setError("");
    setStarting(true);
    try {
      const band = BAND_OPTIONS[bandIdx];
      const { id, label } = await createSearch({
        industry,
        states,
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
        {/* Was a 32-word paragraph explaining the loop before he could type a
            word. The four steps below say it faster and stay useful after the
            first read, which prose does not. */}
        <div className="mx-auto mt-3 flex max-w-md items-center justify-center gap-1.5">
          {[
            { Icon: SearchIcon, label: "Find" },
            { Icon: BuildingIcon, label: "Read" },
            { Icon: ZapIcon, label: "Judge" },
            { Icon: UsersIcon, label: "Contact" },
          ].map(({ Icon, label }, i) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="flex flex-col items-center gap-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-[11px] font-medium text-gh-ink-muted">{label}</span>
              </div>
              {i < 3 && <span aria-hidden className="mb-4 h-px w-4 bg-gh-border" />}
            </div>
          ))}
        </div>

        {/* The form asks for vertical, states and revenue — all of which
            describe the COMPANY. Nothing anywhere said what the crawler is
            actually hunting for, which is the one thing that makes this
            different from a business directory. */}
        <div className="mx-auto mt-5 max-w-2xl text-left">
          <WhatCountsAsSignal />
        </div>
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
                      {/* Skipping is a first-class path, not a dead end, the
                          stated default runs and stays visible below. */}
                      <button
                        type="button"
                        onClick={() => setResolved((r) => [...r, q.field])}
                        className="rounded-full px-3 py-1 text-xs font-medium text-gh-ink-muted underline underline-offset-2 hover:text-gh-ink"
                      >
                        Skip, {q.skipLabel.toLowerCase()}
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
          className="mt-2 w-full cursor-pointer rounded py-1.5 text-center text-[11px] font-medium text-gh-ink-muted underline underline-offset-2 transition-colors duration-200 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          {showManual ? "Hide the form, just type it" : "Set it up with the form instead"}
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

          <div>
            <label id="vertical-label" className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
              Vertical
            </label>
            <div role="group" aria-labelledby="vertical-label" className="flex gap-2">
              {(["landscaping", "home_builder"] as Industry[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIndustry(key)}
                  aria-pressed={industry === key}
                  className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                    industry === key
                      ? "border-gh-navy bg-gh-navy text-white"
                      : "border-gh-border bg-gh-surface-sunken text-gh-ink-secondary hover:border-gh-sky/40 hover:text-gh-ink"
                  }`}
                >
                  {industry === key && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
                  {INDUSTRY_META[key].label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <StatePicker value={states} onChange={setStates} />
          </div>

          <div className="mt-4">
            <label htmlFor="refinement" className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
              Signal focus <span className="font-normal text-gh-ink-muted">(optional)</span>
            </label>
            {/* Deliberately does NOT steer discovery, only nudges what
                classification pays attention to within the vertical + state
                above. Letting free text pick which companies get found is how a
                search drifts off the agreed vertical; the two required
                structured inputs exist to make that impossible. */}
            <p className="mb-1.5 text-[11px] leading-relaxed text-gh-ink-muted">
              A hint for what to look for within{" "}
              {INDUSTRY_META[industry ?? "landscaping"].label.toLowerCase()} in{" "}
              {states.includes(NATIONWIDE)
                ? "the United States"
                : states.length === 0
                  ? "your chosen states"
                  : states.length <= 2
                    ? states.map(stateNameFor).join(" and ")
                    : `the ${states.length} states above`}{" "}
             , it never changes which companies get searched.
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
              Larger targets take longer, the pipeline keeps discovering and
              classifying new companies in rounds until it gets close.
            </p>
          )}

          <button
            type="button"
            onClick={startSearch}
            disabled={!canSearch}
            className="mt-5 w-full cursor-pointer rounded-xl bg-gh-navy py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Starting…" : "Search"}
          </button>
          {/* A disabled button with no stated reason is a dead end, say which
              input is still missing rather than leaving him to guess. */}
          {!canSearch && !starting && (
            <p className="mt-1.5 text-center text-[11px] font-medium text-gh-ink-muted" aria-live="polite">
              {industry === null && states.length === 0
                ? "Pick a vertical and at least one state to search."
                : industry === null
                  ? "Pick a vertical to search."
                  : "Pick at least one state to search."}
            </p>
          )}
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
            No searches yet, run your first one above.
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
