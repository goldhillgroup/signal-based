"use client";

import { useState } from "react";
import { SettingRow } from "./SettingRow";
import { ConfirmDialog } from "./ConfirmDialog";
import { SEARCH_CEILING_PER_COMPANY_USD } from "@/lib/pipeline/pricing";
import { targetUnit } from "@/lib/pipeline/target-count";
import { useRouter } from "next/navigation";
import { useSearches } from "@/lib/searches-store";
import { AGREED_STATES, NATIONWIDE, stateNameFor } from "@/lib/pipeline/us-states";
import { WhatCountsAsSignal } from "./WhatCountsAsSignal";
import { MODE_META, MODE_ORDER, BAND_OPTIONS, bandIndexFor, ICP_SIGNAL_GROUPS, FOCUS_PHRASES_THAT_STEER } from "@/lib/search-options";
import type { Suggestion } from "@/lib/pipeline/suggestions";
import { DEFAULT_ICP, type Icp } from "@/lib/pipeline/icp-types";
import { INDUSTRY_META } from "@/lib/signal-meta";
import { applyAnswer, bandLabel, labelFor, type IntakeResult } from "@/lib/pipeline/intake-types";
import type { Industry, SearchMode } from "@/lib/supabase/types";
import { FolderCard } from "./FolderCard";
import { ReturnOverview } from "./ReturnOverview";
import { SearchProgress } from "./SearchProgress";
import { StatePicker } from "./StatePicker";
import { BuildingIcon, CheckIcon, SearchIcon, UsersIcon, ZapIcon } from "./icons";
import { passesNeeded, companiesPerPass, scansFor } from "@/lib/pipeline/scan-limits";
import { RUN_CEILING_MS } from "@/lib/pipeline/reap";

// 5 and 8 added at the bottom. At the platform's default 300s ceiling a single
// pass reads about 57 companies, so 8 is the largest target that finishes in
// one press — and before this the smallest option on offer was 10, which could
// not. The bigger targets stay: they work, they just take more than one press,
// and the note under the picker says so.
const TARGET_OPTIONS = [5, 8, 10, 20, 50];

// Shown under the ask box. Deliberately span the shapes the old regex parser
// silently mishandled — a multi-state request, a region, a metro — so the
// examples double as a demonstration that those now work.
const ASK_EXAMPLES = [
  "Landscaping and HVAC companies in Texas, $5-30M",
  "Family-owned home builders around the Bay Area",
  "Lawn care firms in the Southeast, 10 leads",
];


export function SearchHome({
  suggestions = [],
  icp = DEFAULT_ICP,
}: {
  suggestions?: Suggestion[];
  icp?: Icp;
}) {
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
  // A SET, not one choice. "Landscaping and HVAC" is a reasonable search and
  // used to mean two runs over the same geography. Empty means every vertical
  // in the ICP, which is also the default — the client narrows if he wants to.
  const [industries, setIndustries] = useState<Industry[]>([]);
  const industry = industries[0] ?? null;
  // Defaults to all four agreed states — the signed scope, and the most likely
  // thing to want. It is not more expensive than picking one: the target
  // (companies to find) is what bounds cost, while locationForRound() rotates
  // state-by-state per round, so four states spread the SAME number of rounds
  // across more ground instead of adding rounds.
  const [states, setStates] = useState<string[]>([...AGREED_STATES]);
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [refinement, setRefinement] = useState("");
  // Off by default. Cross-search memory is what makes a repeat search useful
  // rather than wasteful, so the interesting question is not whether to skip
  // but whether the person searching KNOWS it is happening — which is why this
  // exists as a labelled switch instead of silent behaviour.
  const [includeAlreadyChecked, setIncludeAlreadyChecked] = useState(false);
  // 8, the largest that completes in a single pass at the default ceiling.
  // Was 20, which needs three.
  const [target, setTarget] = useState(8);
  // 'filter' counts companies that fit, which arrive about one in six.
  // 'signal' and 'hybrid' count founder-and-successor pairs, which arrive
  // about one in twenty — so the same number means a very different amount
  // of reading, and the copy below has to say so rather than let someone
  // conclude the product is broken when the world is simply like that.
  const seekingSignals = mode !== "filter";
  const passes = passesNeeded(target, RUN_CEILING_MS, seekingSignals);
  const willRead = scansFor(target, seekingSignals);
  const perPass = companiesPerPass(RUN_CEILING_MS);
  // Opens on the band saved as the ideal client, not a hardcoded 0. The
  // baseline is now $5-15M (the ICP sweet spot) — that is DEFAULT_ICP — one place
  // Jonathan can change rather than three that have to be kept in step.
  const [bandIdx, setBandIdx] = useState(() =>
    bandIndexFor(icp.revenueMinMusd, icp.revenueMaxMusd)
  );

  const [running, setRunning] = useState<{ id: string; label: string } | null>(null);
  const [starting, setStarting] = useState(false);
  // A SEARCH SPENDS MONEY AND DID NOT ASK.
  //
  // Enrichment has confirmed for a long time — "Look up these emails?", with the
  // bill on it — because it bills per person looked up. A search bills per
  // company READ, which is the bigger number of the two: a wide one reads 240
  // and costs several dollars. It went straight from a click to spending.
  const [confirmSearch, setConfirmSearch] = useState(false);
  const [error, setError] = useState("");

  // A nationwide search carries the sentinel "US" rather than a list, so
  // "something is selected" is the real precondition, not "a named state is".
  // No vertical picked means every vertical, so only geography is required.

  // SUMMARIES FOR THE COLLAPSED ROWS.
  //
  // Progressive disclosure is only honest when the summary is complete: if a
  // person has to open a row to find out what it is set to, the row has hidden
  // information rather than tidied it. Each of these states the setting the
  // way someone would say it out loud.
  const verticalSummary =
    industries.length === 0
      ? `All ${Object.keys(INDUSTRY_META).length} verticals`
      : industries.length <= 2
        ? industries.map((i) => INDUSTRY_META[i].label).join(" + ")
        : `${industries.length} verticals`;

  const stateSummary = states.includes(NATIONWIDE)
    ? "Nationwide"
    : states.length === 0
      ? "None picked"
      : states.length <= 3
        ? states.map(stateNameFor).join(", ")
        : `${states.length} states`;


  // SIGNAL CHIPS AND THE TEXT FIELD ARE THE SAME VALUE.
  //
  // The field stays the source of truth and the chips read from it, so a
  // clicked chip and a typed phrase cannot disagree — a chip is "on" when its
  // phrase is present, and clicking it adds or removes that phrase. Typing
  // freely still works, and lights up any chip whose phrase you happen to
  // write.
  const focusPhrases = refinement
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const toggleSignal = (phrase: string) => {
    const has = focusPhrases.some((p) => p.toLowerCase() === phrase.toLowerCase());
    const next = has
      ? focusPhrases.filter((p) => p.toLowerCase() !== phrase.toLowerCase())
      : [...focusPhrases, phrase];
    setRefinement(next.join(", "));
  };

  const canSearch = states.length > 0 && !starting;
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
    if (states.length === 0 || starting) return;
    setError("");
    setStarting(true);
    try {
      const band = BAND_OPTIONS[bandIdx];
      const { id, label } = await createSearch({
        industries,
        states,
        refinement,
        includeAlreadyChecked,
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
          placeholder="e.g. Family-owned HVAC and landscaping companies in Texas doing $5-30M…"
          className="w-full resize-none rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(suggestions.length > 0
            ? suggestions.map((sg) => ({ text: sg.text, why: sg.why }))
            : ASK_EXAMPLES.map((ex) => ({ text: ex, why: "" }))
          ).map(({ text: ex, why }) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="rounded-full border border-gh-border bg-gh-surface px-2.5 py-1 text-[11px] font-medium text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink"
            >
              {ex}
              {/* The REASON, on the chip. A bare suggestion is a guess you
                  have to trust; "never searched" or "12 due for a free
                  re-check" is a fact you can check. */}
              {why && <span className="ml-1.5 text-gh-ink-muted">· {why}</span>}
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
          {/* ── SETTINGS, AS READABLE LINES ────────────────────────────────
              Every control used to be on screen at once: three modes, eight
              verticals wrapping onto two ragged rows, twelve states as twelve
              filled navy buttons, five revenue chips, five target chips, a
              checkbox and a text field. Around forty controls, most already
              correct, all competing equally — it read as a wall.

              Collapsing them is only safe because the DEFAULTS ARE RIGHT:
              every vertical, the agreed states, hybrid, the ICP sweet spot.
              Someone opening this screen usually wants to press Search. Each
              row states its setting in words, so opening one is a choice
              rather than the only way to find out what it says.

              Signal focus stays OPEN — it is the one thing he actually types,
              it is empty by default, and a collapsed empty field would be
              invisible rather than merely tidy. */}
          <div className="rounded-xl border border-gh-border bg-gh-surface-sunken px-3.5">
            <SettingRow label="Mode" value={MODE_META[mode].label}>
              <div className="grid grid-cols-3 gap-2">
                {MODE_ORDER.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    className={`min-h-11 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors duration-200 ${
                      mode === key
                        ? "border-gh-navy bg-gh-navy text-white"
                        : "border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40"
                    }`}
                  >
                    {MODE_META[key].label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-gh-ink-muted">
                {MODE_META[mode].description}
              </p>
            </SettingRow>

            <SettingRow label="Verticals" value={verticalSummary}>
              <p className="mb-2 text-[11px] leading-relaxed text-gh-ink-muted">
                Pick any combination — landscaping and HVAC together is one
                search. Pick none to cover every vertical in the profile.
              </p>
              <div role="group" aria-label="Verticals" className="flex flex-wrap gap-2">
                {(Object.keys(INDUSTRY_META) as Industry[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setIndustries((cur) =>
                        cur.includes(key) ? cur.filter((i) => i !== key) : [...cur, key]
                      )
                    }
                    aria-pressed={industries.includes(key)}
                    className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                      industries.includes(key)
                        ? "border-gh-navy bg-gh-navy text-white"
                        : "border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40 hover:text-gh-ink"
                    }`}
                  >
                    {industries.includes(key) && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
                    {INDUSTRY_META[key].label}
                  </button>
                ))}
              </div>
            </SettingRow>

            <SettingRow label="States" value={stateSummary}>
              <StatePicker value={states} onChange={setStates} />
            </SettingRow>

            <SettingRow label="Revenue band" value={BAND_OPTIONS[bandIdx].label}>
              <div className="flex flex-wrap gap-2">
                {BAND_OPTIONS.map((b, i) => (
                  <button
                    key={b.label}
                    type="button"
                    onClick={() => setBandIdx(i)}
                    className={`min-h-11 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                      bandIdx === i
                        ? "bg-gh-navy text-white"
                        : "border border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </SettingRow>

            <SettingRow
              label={MODE_META[mode].targetLabel.replace(/:$/, "")}
              value={`${target}${seekingSignals ? " pairs" : " companies"}`}
            >
              <div className="flex flex-wrap gap-2">
                {TARGET_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTarget(n)}
                    className={`min-h-11 min-w-11 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                      target === n
                        ? "bg-gh-navy text-white"
                        : "border border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-gh-ink-secondary">
                {seekingSignals ? (
                  <>
                    Reads up to {willRead} companies. A founder-and-successor
                    pair turns up in roughly one company in twenty, so expect a
                    handful of confirmed pairs plus every good family-owned
                    company found on the way — those are kept, not discarded.
                  </>
                ) : (
                  <>Reads up to {willRead} companies to find {target} that fit.</>
                )}{" "}
                {passes > 1 ? (
                  <>
                    About {passes} passes: the server stops a run at{" "}
                    {Math.round(RUN_CEILING_MS / 60000)} minutes, around{" "}
                    {perPass} companies. Everything found is saved and it
                    carries on by itself.
                  </>
                ) : (
                  <>Finishes in one pass.</>
                )}
              </p>
            </SettingRow>

            <SettingRow
              label="Repeat searches"
              value={includeAlreadyChecked ? "Re-read everything" : "Skip what I've seen"}
            >
              {/* The answer to "if I search the same thing twice, does it just
                  give me the same list?" — a fair thing to wonder, previously
                  answered only in a server log. It does not: already-judged
                  companies are skipped, so a repeat goes FURTHER rather than
                  re-buying answers it has. */}
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={includeAlreadyChecked}
                  onChange={(e) => setIncludeAlreadyChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-gh-sky"
                />
                <span className="text-[11px] leading-relaxed text-gh-ink-muted">
                  {includeAlreadyChecked
                    ? "Every company will be read again, including ones already judged. Slower, and it costs a full read each — use it when you want a previous pass re-done."
                    : "Companies already judged are skipped, so searching the same thing again finds NEW ones instead of repeating the last list. Your existing leads stay where they are."}
                </span>
              </label>
            </SettingRow>
          </div>

          {/* ── SIGNAL FOCUS: PICKED, NOT TYPED ────────────────────────────
              This was a free-text box with three example chips. Two problems.
              The chips REPLACED whatever was in the field, so only one idea
              could ever be expressed; and the other nine signals in his own
              profile were reachable only by knowing they existed and typing
              the right words.

              Now it is the twelve signals, in the four groups they naturally
              fall into, laid out as an even grid rather than a ragged wrap of
              pills. Selection only — his standing definition in his own words
              still lives in Settings, and this is the question "what am I
              looking for THIS time".

              Each row is a real checkbox: it gets keyboard, screen-reader
              semantics and a 44px target for free, which a styled div does
              not. */}
          <fieldset className="mt-4">
            <legend className="mb-1.5 text-xs font-semibold text-gh-ink-secondary">
              Signal focus <span className="font-normal text-gh-ink-muted">(optional)</span>
            </legend>
            <p className="mb-2.5 text-[11px] leading-relaxed text-gh-ink-muted">
              What to look for within {verticalSummary.toLowerCase()} in{" "}
              {stateSummary.toLowerCase()}. It shapes the questions the search
              asks, so it changes which companies get found — the verticals and
              states stay fixed. Pick none and it looks for all of them.
            </p>

            <div className="space-y-3">
              {ICP_SIGNAL_GROUPS.map((group) => (
                <div key={group.heading}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gh-ink-muted">
                    {group.heading}
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-3">
                    {group.signals.map((sig) => {
                      const on = focusPhrases.some(
                        (ph) => ph.toLowerCase() === sig.phrase.toLowerCase()
                      );
                      return (
                        <label
                          key={sig.label}
                          title={sig.phrase}
                          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-medium leading-snug transition-colors duration-200 ${
                            on
                              ? "border-gh-navy bg-gh-navy text-white"
                              : "border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40 hover:text-gh-ink"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleSignal(sig.phrase)}
                            className="h-3.5 w-3.5 shrink-0 accent-gh-sky"
                          />
                          {sig.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* IN HIS OWN WORDS, and not a second setting — the same string the
                chips above edit.
                
                The chips cover the twelve signals in the written ICP, which is
                most of what he wants most of the time. It is not everything he
                knows: "founder's daughter just came back from running someone
                else's branch" is a real thing a coach notices and no checkbox
                will ever carry it. Removing the box made the product only as
                expressive as my list of twelve.
                
                One source of truth, two ways to edit it: typing lights up any
                chip whose phrase you happen to write, and clicking a chip
                writes its phrase into the text. Neither can silently disagree
                with the other, because there is only one value. */}
            <div className="mt-3">
              <label
                htmlFor="refinement"
                className="mb-1.5 block text-[11px] font-semibold text-gh-ink-secondary"
              >
                Or describe it yourself
              </label>
              <textarea
                id="refinement"
                rows={2}
                autoComplete="off"
                value={refinement}
                onChange={(e) => setRefinement(e.target.value)}
                placeholder={
                  icp.signalFocus
                    ? `${icp.signalFocus} (your ideal client)`
                    : "e.g. founder in his sixties, daughter recently made general manager"
                }
                className="w-full resize-y rounded-lg border border-gh-border bg-gh-surface px-3 py-2.5 text-sm leading-relaxed text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-gh-ink-muted">
                Separate several with commas. This is the same text the buttons
                above write, so you can tick a few and then edit the wording.
              </p>
            </div>

            {/* Honest about the cap rather than letting someone tick eight and
                assume all eight are being searched for. */}
            {focusPhrases.length > FOCUS_PHRASES_THAT_STEER && (
              <p className="mt-2 text-[11px] leading-relaxed text-gh-ink-muted">
                The first {FOCUS_PHRASES_THAT_STEER} steer which companies get
                found — that cap keeps the search bill flat. All{" "}
                {focusPhrases.length} still sharpen how each page is judged.
              </p>
            )}
          </fieldset>

          <button
            type="button"
            onClick={() => setConfirmSearch(true)}
            disabled={!canSearch}
            className="mt-5 w-full cursor-pointer rounded-xl bg-gh-navy py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Starting\u2026" : "Search"}
          </button>
          {/* A disabled button with no stated reason is a dead end — say which
              input is still missing rather than leaving him to guess. */}
          {!canSearch && !starting && (
            <p className="mt-1.5 text-center text-[11px] font-medium text-gh-ink-muted" aria-live="polite">
              Pick at least one state to search.
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
        <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

    {/* Confirms before ANY money moves, matching the enrichment dialog that has
        always done this. The numbers are the same ones printed on the form, so
        the dialog cannot quote a figure the form disagrees with. */}
    <ConfirmDialog
      open={confirmSearch}
      title="Start this search?"
      confirmLabel="Yes, start searching"
      cancelLabel="No, go back"
      onConfirm={() => {
        setConfirmSearch(false);
        startSearch();
      }}
      onCancel={() => setConfirmSearch(false)}
      body={
        <>
          {/* TWO LINES. This was four sentences: the verticals and states
              spelled out (both already chosen on the form directly behind this
              dialog), a clause about re-reading companies, a clause about
              email being separate, and a third paragraph about passes. All
              true, none of it what you need in order to answer yes or no.
              The two facts that decide it are how much reading and how much
              money, so those are the two lines, and the passes count rides
              along in the first because it is the same fact. */}
          <p>
            Reads up to{" "}
            <strong className="font-semibold text-gh-ink">{willRead} companies</strong>
            {passes > 1 ? ` over about ${passes} passes` : ""}, looking for {target}{" "}
            {targetUnit(mode, target)}.
          </p>
          <p className="mt-2">
            Up to{" "}
            <strong className="font-semibold text-gh-ink">
              ${(willRead * SEARCH_CEILING_PER_COMPANY_USD).toFixed(2)}
            </strong>
            , usually about half that. Email addresses are a separate step you
            approve on its own.
          </p>
        </>
      }
    />

    </div>
  );
}
