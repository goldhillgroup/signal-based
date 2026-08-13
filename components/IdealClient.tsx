"use client";

import { useState } from "react";
import { BAND_OPTIONS, bandIndexFor, REFINEMENT_EXAMPLES } from "@/lib/search-options";
import { DEFAULT_ICP, type Icp } from "@/lib/pipeline/icp-types";
import { CheckIcon } from "./icons";

/**
 * "Who am I looking for?" — the one control that changes what the product
 * hunts for rather than how much of it.
 *
 * This is not a preference pane. Since the discovery fix, the signal focus is
 * turned into real search queries (see refinementQueries), so this sentence
 * determines which companies are ever looked at. It sits at the top of Settings
 * for that reason, above the vendor keys: the keys keep it running, this
 * decides what it does.
 */
export function IdealClient({ initial }: { initial: Icp }) {
  const [icp, setIcp] = useState<Icp>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const bandIdx = bandIndexFor(icp.revenueMinMusd, icp.revenueMaxMusd);
  const isDefault =
    icp.signalFocus === DEFAULT_ICP.signalFocus &&
    icp.revenueMinMusd === DEFAULT_ICP.revenueMinMusd &&
    icp.revenueMaxMusd === DEFAULT_ICP.revenueMaxMusd;

  async function save(next: Icp) {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/icp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Could not save.");
      setIcp(body.icp);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-gh-border bg-gh-surface p-5 fade-up">
      <h2 className="font-display text-lg font-semibold text-gh-ink">Your ideal client</h2>
      <p className="mt-0.5 text-sm text-gh-ink-secondary">
        Every search starts from this. It is not just a filter applied at the
        end — it becomes the questions the search actually asks, so changing it
        changes which companies get found.
      </p>

      <div className="mt-4">
        <label htmlFor="icp-focus" className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
          The signal you are looking for
        </label>
        <textarea
          id="icp-focus"
          rows={2}
          value={icp.signalFocus}
          onChange={(e) => setIcp({ ...icp, signalFocus: e.target.value.slice(0, 300) })}
          placeholder={DEFAULT_ICP.signalFocus}
          className="w-full resize-none rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
        />
        <p className="mt-1.5 text-xs text-gh-ink-muted">
          Describe the <em>moment</em>, not the industry — the vertical and the
          states are chosen per search. &ldquo;Founder still leading with a son
          or daughter stepping up&rdquo; finds companies; &ldquo;landscaping
          company&rdquo; only repeats a filter that already exists.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {REFINEMENT_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setIcp({ ...icp, signalFocus: ex })}
              className="lift rounded-full border border-gh-border px-2.5 py-1 text-xs text-gh-ink-secondary hover:border-gh-sky hover:text-gh-ink"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <span className="mb-1.5 block text-xs font-semibold text-gh-ink-secondary">
          Revenue band
        </span>
        <div className="flex flex-wrap gap-1.5">
          {BAND_OPTIONS.map((b, i) => (
            <button
              key={b.label}
              type="button"
              aria-pressed={i === bandIdx}
              onClick={() => setIcp({ ...icp, revenueMinMusd: b.min, revenueMaxMusd: b.max })}
              className={`lift rounded-full border px-3 py-1.5 text-xs font-medium ${
                i === bandIdx
                  ? "border-gh-sky bg-gh-sky/10 text-gh-ink"
                  : "border-gh-border text-gh-ink-secondary hover:border-gh-sky"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* THE REST OF HIS WRITTEN PROFILE, and every one of them optional.
          
          These were hardcoded gates read off the document he sent — 25-150
          employees, 15+ years, no lifestyle businesses. Wrong shape: his own
          wording is "GENERALLY 25-150" and "USUALLY 15+ years", a description
          of his typical client rather than a specification, and a threshold
          buried in a gate is one he cannot see or argue with.
          
          Blank means the check is off, not zero. And nothing here rejects on
          missing information — a page that never states its headcount is never
          assumed to be small. */}
      <div className="mt-5 border-t border-gh-border pt-5">
        <span className="mb-1 block text-xs font-semibold text-gh-ink-secondary">
          Company size <span className="font-normal text-gh-ink-muted">(leave blank to ignore)</span>
        </span>
        <p className="mb-2.5 text-[11px] leading-relaxed text-gh-ink-muted">
          Only used when a page actually states these. A company that says
          nothing about its size is never cut for it.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-[11px] font-medium text-gh-ink-muted">
            Employees, from
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={icp.employeeMin ?? ""}
              onChange={(e) =>
                setIcp({ ...icp, employeeMin: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="mt-1 block w-24 rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-2 text-sm text-gh-ink focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
            />
          </label>
          <label className="text-[11px] font-medium text-gh-ink-muted">
            to
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={icp.employeeMax ?? ""}
              onChange={(e) =>
                setIcp({ ...icp, employeeMax: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="mt-1 block w-24 rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-2 text-sm text-gh-ink focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
            />
          </label>
          <label className="text-[11px] font-medium text-gh-ink-muted">
            Trading at least (years)
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={icp.minYearsInBusiness ?? ""}
              onChange={(e) =>
                setIcp({
                  ...icp,
                  minYearsInBusiness: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="mt-1 block w-28 rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-2 text-sm text-gh-ink focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
            />
          </label>
        </div>

        <div className="mt-4 space-y-2.5">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={icp.excludeLifestyleBusinesses}
              onChange={(e) => setIcp({ ...icp, excludeLifestyleBusinesses: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gh-sky"
            />
            <span className="text-[11px] leading-relaxed">
              <span className="font-semibold text-gh-ink-secondary">
                Skip one and two person operations
              </span>
              <span className="mt-0.5 block text-gh-ink-muted">
                Your profile says these are &ldquo;not lifestyle businesses or solo
                professional practices&rdquo;. Only refuses companies whose own page
                describes one or two people — there is nothing to hand over but a truck.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={icp.professionalServicesNeedFamily}
              onChange={(e) => setIcp({ ...icp, professionalServicesNeedFamily: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gh-sky"
            />
            <span className="text-[11px] leading-relaxed">
              <span className="font-semibold text-gh-ink-secondary">
                Professional-services firms need several family members
              </span>
              <span className="mt-0.5 block text-gh-ink-muted">
                Your words: &ldquo;select professional-services firms with multiple
                family members involved&rdquo;. Switch this off and the vertical also
                returns single-principal architecture, engineering and accounting firms.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save(icp)}
          disabled={saving}
          className="hover-spring rounded-lg bg-gh-ink px-4 py-2 text-sm font-semibold text-gh-surface disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={() => save(DEFAULT_ICP)}
            disabled={saving}
            className="text-xs text-gh-ink-muted underline underline-offset-2 hover:text-gh-ink disabled:opacity-50"
          >
            Reset to the default
          </button>
        )}
        {saved && (
          <span className="flex items-center gap-1 text-xs font-medium text-gh-good">
            <CheckIcon className="h-3.5 w-3.5" /> Saved — applies to the next search
          </span>
        )}
        {error && <span className="text-xs text-gh-critical">{error}</span>}
      </div>
    </section>
  );
}
