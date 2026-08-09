"use client";

import { useId, useState } from "react";
import { US_STATES, AGREED_STATES, stateNameFor } from "@/lib/pipeline/us-states";
import { CheckIcon, ChevronDownIcon, XIcon } from "./icons";

/**
 * State selection as a real PARAMETER — one, two, three or all four of the
 * agreed states, not a single pick.
 *
 * The whole pipeline (POST /api/search, the orchestrator, the metro/phrasing
 * rotation) has always taken a `states` ARRAY, and the free-text path already
 * produces one: typing "Texas and Oklahoma" ran a genuine two-state search.
 * The structured form was the only thing that couldn't say it — a single
 * <select>. So this is a UI gap being closed, not a new capability.
 *
 * Shape of the control follows the shape of the decision:
 *   - the four agreed states are TOGGLES, always visible, because picking
 *     among them is the actual daily choice
 *   - "All four" is one click, because the full agreed scope is the single
 *     most likely thing to want
 *   - the other 47 states sit behind a disclosure. They stay reachable (the
 *     engine is not restricted to four) without putting a 51-item list in
 *     front of a decision that is nearly always about four.
 */
export function StatePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [showOthers, setShowOthers] = useState(false);
  const groupId = useId();

  const selected = new Set(value);
  const agreedSelected = AGREED_STATES.filter((c) => selected.has(c));
  const extraSelected = value.filter((c) => !AGREED_STATES.includes(c));
  const allAgreed = agreedSelected.length === AGREED_STATES.length;

  function toggle(code: string) {
    onChange(selected.has(code) ? value.filter((c) => c !== code) : [...value, code]);
  }

  // Deliberately additive rather than a replace: if he has already picked
  // Georgia, "All four" should not silently throw it away.
  function selectAllAgreed() {
    onChange(
      allAgreed
        ? value.filter((c) => !AGREED_STATES.includes(c))
        : [...extraSelected, ...AGREED_STATES]
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span id={groupId} className="text-xs font-semibold text-gh-ink-secondary">
          States <span className="font-normal text-gh-ink-muted">(pick any)</span>
        </span>
        <button
          type="button"
          onClick={selectAllAgreed}
          className="-my-1 cursor-pointer rounded px-1 py-1.5 text-[11px] font-semibold text-gh-sky underline-offset-2 transition-colors duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          {allAgreed ? "Clear all four" : "All four agreed"}
        </button>
      </div>

      {/* NO "anywhere in the US" option here, deliberately.
          Phase 1 of the signed scope is "one narrow niche in one geography you
          pick", and its deliverable is a list dense enough to prove the signal
          is real in a named territory. Searching everywhere returns a thin
          scatter across twenty metros: weaker evidence, for more money, in
          service of a question nobody asked. Reusing the crawler on another
          geography means running it again, which is what "yours to keep and
          reuse" describes.
          The pipeline and POST /api/search still accept nationwide ("US") for
          anyone who wants it deliberately — it is simply not the front door. */}
      {/* The four agreed states, the daily decision, always visible. */}
      <div role="group" aria-labelledby={groupId} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {AGREED_STATES.map((code) => {
          const on = selected.has(code);
          return (
            <button
              key={code}
              type="button"
              onClick={() => toggle(code)}
              aria-pressed={on}
              className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                on
                  ? "border-gh-navy bg-gh-navy text-white"
                  : "border-gh-border bg-gh-surface-sunken text-gh-ink-secondary hover:border-gh-sky/40 hover:text-gh-ink"
              }`}
            >
              {/* Check + fill together, colour is never the only signal. */}
              {on && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
              {stateNameFor(code)}
            </button>
          );
        })}
      </div>

      {/* Everything else, behind a disclosure, reachable, not in the way. */}
      <button
        type="button"
        onClick={() => setShowOthers((v) => !v)}
        aria-expanded={showOthers}
        className="mt-1.5 flex cursor-pointer items-center gap-1 rounded px-1 py-1.5 text-[11px] font-medium text-gh-ink-muted transition-colors duration-200 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
      >
        <ChevronDownIcon
          className={`h-3.5 w-3.5 transition-transform duration-200 ${showOthers ? "rotate-180" : ""}`}
        />
        {showOthers ? "Hide other states" : `Other states${extraSelected.length ? ` (${extraSelected.length} selected)` : ""}`}
      </button>

      {showOthers && (
        <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-gh-border bg-gh-surface-sunken p-2">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {US_STATES.filter((s) => !AGREED_STATES.includes(s.code)).map((s) => {
              const on = selected.has(s.code);
              return (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => toggle(s.code)}
                  aria-pressed={on}
                  className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                    on ? "bg-gh-navy text-white" : "text-gh-ink-secondary hover:bg-gh-surface hover:text-gh-ink"
                  }`}
                >
                  {on ? <CheckIcon className="h-3 w-3 shrink-0" /> : <span className="w-3 shrink-0" />}
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Only for states picked inside the collapsed list, those would
          otherwise vanish the moment the disclosure closes, leaving a search
          running against a state with nothing on screen to say so. The four
          agreed toggles above are already their own summary, so repeating them
          here would just be the same row twice. */}
      {extraSelected.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-gh-ink-muted">Also searching:</span>
          {extraSelected.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 rounded-full border border-gh-border bg-gh-surface py-1 pl-2.5 pr-1 text-[11px] font-semibold text-gh-ink-secondary"
            >
              {stateNameFor(code)}
              <button
                type="button"
                onClick={() => toggle(code)}
                aria-label={`Remove ${stateNameFor(code)}`}
                className="tap-sm cursor-pointer rounded-full p-1 text-gh-ink-muted transition-colors duration-200 hover:bg-gh-surface-sunken hover:text-gh-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : value.length === 0 ? (
        <p className="mt-2.5 text-[11px] font-medium text-gh-serious">
          Pick at least one state to search.
        </p>
      ) : null}
    </div>
  );
}
