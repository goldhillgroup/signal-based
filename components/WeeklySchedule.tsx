"use client";

import { useState } from "react";
import { WhatCountsAsSignal } from "./WhatCountsAsSignal";
import { MODE_META, MODE_ORDER, BAND_OPTIONS, ICP_SIGNALS } from "@/lib/search-options";
import { DAY_NAMES, type WeeklySchedule as Schedule } from "@/lib/pipeline/schedule-types";
import { INDUSTRY_META } from "@/lib/signal-meta";
import type { Industry } from "@/lib/supabase/types";
import { StatePicker } from "./StatePicker";
import { CheckIcon } from "./icons";
import { harvestEstimate, monthlyPageUse, HARVEST_CEILING_MS } from "@/lib/pipeline/schedule-types";

// Down again, and for the third time the same lesson: offering a number that
// cannot survive a month is offering a broken setting.
//
// 50 went first. Then 20 -> 15, computed at six companies read per result. But
// the harvest runs in HYBRID mode, and hybrid counts founder-and-successor
// pairs, which arrive about one in TWENTY — so 15 across two verticals is
// 2,064 Firecrawl pages a month against a 1,025 allowance, not 774.
//
// At two verticals the arithmetic allows 5. Anything above that is offered
// only because a single-vertical harvest can afford more, and the estimate
// line below says so when it cannot.
const TARGETS = [3, 5, 8];

/**
 * On/off switch and configuration for the weekly harvest.
 *
 * The whole point is that it is HIS to control. A scheduled job that spends
 * money without a visible switch is not a feature, it is a surprise on a
 * statement — so the toggle is the first thing on the card, its state is
 * unambiguous, and nothing saves until he presses save.
 */
export function WeeklySchedule({
  initial,
  cronConfigured,
}: {
  initial: Schedule;
  cronConfigured: boolean;
}) {
  // Handed down from the server page rather than fetched on mount. The Settings
  // page is already a server component with service-role access, so it can read
  // the schedule directly — which removes a loading flash, a round trip, and
  // the setState-in-effect this component used to open with.
  const [schedule, setSchedule] = useState<Schedule>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function save(next: Schedule) {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Could not save.");
      setSchedule(body.schedule);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Recomputed on every change, because the answer depends on the target AND
  // how many verticals are ticked — the two controls that sit next to it.
  // Measured against the HARVEST's own driver (GitHub Actions, 90-minute job),
  // not the Vercel function ceiling. Warning about 5 minutes here was left over
  // from when Vercel's cron drove it, and told the user a perfectly runnable
  // harvest would be cut off.
  const estimate = harvestEstimate(
    schedule.targetPerRun,
    schedule.industries.length,
    HARVEST_CEILING_MS
  );
  // Snapped to an option the picker actually offers. The raw answer is the
  // largest target that fits (12 for two verticals), and offering a number the
  // three chips below cannot represent would leave none of them selected after
  // the fix — a control that looks broken because it accepted your input.
  const suggested = [...TARGETS].reverse().find((n) => n <= estimate.maxTargetThatFits) ?? null;
  // The OTHER limit, and the one the shipped default actually broke: a harvest
  // reads one Firecrawl page per company, every week, against a monthly quota.
  const pages = monthlyPageUse(schedule.targetPerRun, schedule.industries.length);

  const patch = (p: Partial<Schedule>) => setSchedule({ ...schedule, ...p });
  const canEnable = schedule.states.length > 0 && schedule.industries.length > 0;

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-gh-ink">Weekly harvest</h2>
      <p className="mt-0.5 text-sm text-gh-ink-secondary">
        Scan automatically once a week and drop the results in a new folder -
        so there are fresh leads waiting without running a search yourself.
      </p>

      {/* A panel that schedules an automatic scan, without saying what it
          scans FOR. The verticals and states describe where to look; this is
          the only thing that says what it is looking for. */}
      <div className="mt-3">
        <WhatCountsAsSignal compact />
      </div>

      <div className="mt-3 rounded-xl border border-gh-border bg-gh-surface p-4">
        {/* The switch, first and unmissable. */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gh-ink">
              {schedule.enabled ? "On" : "Off"}
            </p>
            <p className="mt-0.5 text-[11px] text-gh-ink-muted">
              {schedule.enabled
                ? `Runs every ${DAY_NAMES[schedule.dayOfWeek]}, at most once every 7 days.`
                : "Nothing runs on its own. You still search whenever you like."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={schedule.enabled}
            aria-label="Weekly harvest"
            disabled={!schedule.enabled && !canEnable}
            onClick={() => save({ ...schedule, enabled: !schedule.enabled })}
            className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40 ${
              schedule.enabled ? "bg-gh-navy" : "bg-gh-border-strong"
            }`}
          >
            {/* left-0.5 is load-bearing. Without an explicit `left`, an
                absolutely positioned child falls back to its STATIC position —
                and a <button> centres its content, so the knob started at the
                track's right edge and the 22px translate carried it clean
                outside. Measured: the knob's right edge sat 20px past the
                track's. Anchoring left and translating by the travel distance
                (44 track - 20 knob - 2 - 2 = 20) keeps it inside at both ends. */}
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-[var(--gh-dur)] ease-[var(--gh-ease-out)] ${
                schedule.enabled ? "translate-x-[20px]" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {!cronConfigured && (
          <p className="mt-3 rounded-lg bg-gh-warning/15 px-3 py-2 text-[11px] leading-relaxed text-gh-ink">
            <strong className="font-semibold">Not wired up yet.</strong> The
            schedule saves, but nothing will call it until the app is deployed
            with a <code className="font-mono">CRON_SECRET</code> and something
            pinging it daily. It cannot run from a laptop.
          </p>
        )}

        <hr className="my-4 border-gh-border" />

        {/* Vertical */}
        <label id="sched-vertical" className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
          Verticals to scan
        </label>
        <div role="group" aria-labelledby="sched-vertical" className="flex flex-wrap gap-2">
          {(Object.keys(INDUSTRY_META) as Industry[]).map((key) => {
            const on = schedule.industries.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  patch({
                    industries: on
                      ? schedule.industries.filter((i) => i !== key)
                      : [...schedule.industries, key],
                  })
                }
                className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                  on
                    ? "border-gh-navy bg-gh-navy text-white"
                    : "border-gh-border bg-gh-surface-sunken text-gh-ink-secondary hover:border-gh-sky/40"
                }`}
              >
                {on && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
                {INDUSTRY_META[key].label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-gh-ink-muted">
          Each vertical becomes its own folder every week.
        </p>

        <div className="mt-4">
          <StatePicker value={schedule.states} onChange={(states) => patch({ states })} />
        </div>

                {/* Identical control to the one-off search form, from the same
            MODE_META. These are the same decision made at two different times,
            and they were two different-looking controls with different wording
            — one screen calling it "Vertical", the other "Verticals to scan". */}
        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
            Mode
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODE_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={schedule.mode === key}
                onClick={() => patch({ mode: key })}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                  schedule.mode === key
                    ? "border-gh-navy bg-gh-navy text-white"
                    : "border-gh-border bg-gh-surface-sunken text-gh-ink-secondary hover:border-gh-sky/40"
                }`}
              >
                {MODE_META[key].label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-gh-ink-muted">
            {MODE_META[schedule.mode].description}
          </p>
        </div>

        {/* SIGNAL FOCUS — the one field a person writes in their own words,
            and the only structured input the harvest could not be given. The
            schedule could set vertical, states, band and mode; this was
            missing from the UI and hardcoded to null in the cron, so a
            scheduled run could never be told what to look for the way a
            manual one can.
            Same caveat as the search form: it nudges CLASSIFICATION, never
            discovery. Free text choosing which companies get found is how a
            search drifts off the agreed vertical. */}
        <div className="mt-4">
          <label
            htmlFor="harvest-refinement"
            className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary"
          >
            Signal focus <span className="font-normal text-gh-ink-muted">(optional)</span>
          </label>
          <p className="mb-1.5 text-[11px] leading-relaxed text-gh-ink-muted">
            What to look for inside the verticals and states above. It shapes
            the questions each run asks, so it changes which companies get
            found — the verticals and states themselves stay fixed.
          </p>
          {/* autoComplete off. Chrome and Safari offer a saved EMAIL into any
              unlabelled text box on an origin where a login form exists — so
              this field, whose whole job is a phrase like "founder retiring",
              was being filled with jonathan@thegoldhillgroup.com. The value is
              sent to the crawler, so an autofilled address is not cosmetic: it
              becomes the search refinement. */}
          <input
            id="harvest-refinement"
            type="text"
            autoComplete="off"
            value={schedule.refinement ?? ""}
            onChange={(e) => patch({ refinement: e.target.value || null })}
            maxLength={200}
            placeholder="e.g. succession signals, founder retiring..."
            className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20 sm:text-sm"
          />
          {/* Same twelve signals as the one-off search form. This field had
              three fixed examples that REPLACED whatever was typed, so the
              harvest could only ever express one of them. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ICP_SIGNALS.map((sig) => {
              const phrases = (schedule.refinement ?? "")
                .split(/[,;\n]/)
                .map((x) => x.trim())
                .filter(Boolean);
              const on = phrases.some((ph) => ph.toLowerCase() === sig.phrase.toLowerCase());
              return (
                <button
                  key={sig.label}
                  type="button"
                  onClick={() => {
                    const next = on
                      ? phrases.filter((ph) => ph.toLowerCase() !== sig.phrase.toLowerCase())
                      : [...phrases, sig.phrase];
                    patch({ refinement: next.join(", ") || null });
                  }}
                  aria-pressed={on}
                  title={sig.phrase}
                  className={`hover-spring flex min-h-8 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                    on
                      ? "bg-gh-navy text-white"
                      : "border border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40 hover:text-gh-ink"
                  }`}
                >
                  {on && <CheckIcon className="h-3 w-3 shrink-0" />}
                  {sig.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* The band the harvest never had. It ran unbounded while the form
            defaulted to $3-15M. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gh-ink-muted">Revenue band:</span>
          {BAND_OPTIONS.map((b) => {
            const on =
              schedule.revenueMinMusd === b.min && schedule.revenueMaxMusd === b.max;
            return (
              <button
                key={b.label}
                type="button"
                aria-pressed={on}
                onClick={() => patch({ revenueMinMusd: b.min, revenueMaxMusd: b.max })}
                className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                  on
                    ? "bg-gh-navy text-white"
                    : "border border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40"
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>


<div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gh-ink-muted">Day:</span>
          <select
            value={schedule.dayOfWeek}
            onChange={(e) => patch({ dayOfWeek: Number(e.target.value) })}
            aria-label="Day of the week to run"
            className="cursor-pointer rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-1.5 text-xs font-semibold text-gh-ink focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
          >
            {DAY_NAMES.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>

          <span className="ml-2 text-xs font-medium text-gh-ink-muted">Companies to find:</span>
          {TARGETS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={schedule.targetPerRun === n}
              onClick={() => patch({ targetPerRun: n })}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                schedule.targetPerRun === n
                  ? "bg-gh-navy text-white"
                  : "border border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40"
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* THE TIME BUDGET, said out loud.
            The cron runs one pipeline per vertical sequentially inside a single
            function invocation, and nothing anywhere checked that total against
            the server's ceiling. The shipped default — both verticals, 20 each —
            needs about 21 minutes against a 13.3-minute limit, so the second
            vertical was killed roughly halfway through every week. It looked
            like a quiet week rather than a bug, because reapStaleRuns closes the
            row out honestly.

            Shown as a warning rather than enforced as a cap: the ceiling depends
            on the hosting plan, so the honest thing is to state the arithmetic
            and let the choice be made with it visible. */}
        {!estimate.fits && (
          <p className="fade-in mt-3 rounded-lg border border-gh-warning/40 bg-gh-warning/[0.10] px-3 py-2 text-[11px] leading-relaxed text-gh-ink-secondary">
            <strong className="font-semibold text-gh-ink">
              This will not finish in one run.
            </strong>{" "}
            {schedule.industries.length} vertical
            {schedule.industries.length === 1 ? "" : "s"} at {schedule.targetPerRun} each is
            about {estimate.minutes.toFixed(0)} minutes of scanning, and the server stops a
            run at {Math.round(HARVEST_CEILING_MS / 60000)}. Whatever it has found is saved, but
            the rest is cut off.{" "}
            {suggested !== null ? (
              <>
                Drop to{" "}
                <button
                  type="button"
                  onClick={() => patch({ targetPerRun: suggested })}
                  className="cursor-pointer font-semibold text-gh-sky underline-offset-2 hover:underline"
                >
                  {suggested} each
                </button>{" "}
                to fit, or scan one vertical.
              </>
            ) : (
              <>Scan one vertical at a time.</>
            )}
          </p>
        )}
        {!pages.fits && (
          <p className="fade-in mt-3 rounded-lg border border-gh-warning/40 bg-gh-warning/[0.10] px-3 py-2 text-[11px] leading-relaxed text-gh-ink-secondary">
            <strong className="font-semibold text-gh-ink">
              This would run out of page credits.
            </strong>{" "}
            {schedule.industries.length} vertical
            {schedule.industries.length === 1 ? "" : "s"} at {schedule.targetPerRun} each,
            every week, reads about {Math.round(pages.pages).toLocaleString()} pages a month
            against a {pages.quota.toLocaleString()} allowance — so the last week of each
            month would find nothing.{" "}
            {pages.maxTargetThatFits > 0 && (
              <>Drop to {pages.maxTargetThatFits} or fewer, or scan one vertical.</>
            )}
          </p>
        )}

        {estimate.fits && schedule.enabled && (
          <p className="mt-3 text-[11px] text-gh-ink-muted">
            About {estimate.minutes < 1 ? "under a minute" : `${estimate.minutes.toFixed(0)} minutes`} of
            scanning per week, inside the {Math.round(HARVEST_CEILING_MS / 60000)} minute job limit.
          </p>
        )}

        {/* DISCOVERY ONLY. A harvest runs the same pipeline a manual search does
            — find companies, read their pages, judge the signal — and stops
            there. It never calls AnymailFinder or MillionVerifier, so it cannot
            spend the email budget while nobody is watching. Buying an address
            stays a deliberate act with a confirmation in front of it. */}
        <p className="mt-3 text-[11px] leading-relaxed text-gh-ink-muted">
          Finds and judges companies only. It never looks up email addresses —
          that stays a separate step you press yourself, so nothing buys
          contacts overnight.
        </p>

        {schedule.lastRunOn && (
          <p className="mt-3 text-[11px] text-gh-ink-muted">
            Last ran {schedule.lastRunOn}.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => save(schedule)}
            disabled={saving}
            className="cursor-pointer rounded-lg bg-gh-navy px-4 py-2 text-xs font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save schedule"}
          </button>
          {saved && !error && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-gh-good" aria-live="polite">
              <CheckIcon className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
          {error && (
            <span className="text-[11px] font-medium text-gh-critical" aria-live="polite">
              {error}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
