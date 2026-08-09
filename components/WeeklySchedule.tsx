"use client";

import { useState } from "react";
import { WhatCountsAsSignal } from "./WhatCountsAsSignal";
import { DAY_NAMES, type WeeklySchedule as Schedule } from "@/lib/pipeline/schedule-types";
import { INDUSTRY_META } from "@/lib/signal-meta";
import type { Industry } from "@/lib/supabase/types";
import { StatePicker } from "./StatePicker";
import { CheckIcon } from "./icons";

const TARGETS = [10, 20, 50];

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
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                schedule.enabled ? "translate-x-[22px]" : "translate-x-0.5"
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
        <div role="group" aria-labelledby="sched-vertical" className="flex gap-2">
          {(["landscaping", "home_builder"] as Industry[]).map((key) => {
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

          <span className="ml-2 text-xs font-medium text-gh-ink-muted">Leads per folder:</span>
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
