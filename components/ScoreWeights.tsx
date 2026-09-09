"use client";

import { useEffect, useState } from "react";
import { DEFAULT_WEIGHTS, WEIGHT_LABELS, type ScoreWeights } from "@/lib/score-weights";

/**
 * What a lead is scored on, and how much each thing is worth.
 *
 * WHY THIS IS SETTABLE. The right weights are Jonathan's opinion, not a fact.
 * He works these territories, and whether a phone number is worth more than a
 * known town is his call. Hard-coding it makes the score an argument he cannot
 * join, which for a product whose whole claim is "you can check this" would be
 * the one number on the page that has to be taken on trust.
 *
 * The running total is shown while editing, because the numbers only mean
 * anything relative to each other and a field edited in isolation tells you
 * nothing about what it did to the scale.
 */
export function ScoreWeightsCard() {
  const [w, setW] = useState<ScoreWeights>(DEFAULT_WEIGHTS);
  const [loaded, setLoaded] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let off = false;
    fetch("/api/score-weights")
      .then((r) => r.json())
      .then((j) => {
        if (off) return;
        if (j?.weights) setW(j.weights);
        setIsDefault(!!j?.isDefault);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      off = true;
    };
  }, []);

  async function save(next: ScoreWeights | { reset: true }) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/score-weights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("reset" in next ? { reset: true } : { weights: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Could not save that.");
      setW(j.weights);
      setIsDefault(!!j.isDefault);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // The most a lead can score: the firm signal rather than the arguable one,
  // and the confirmed address rather than the unchecked one, since those pairs
  // are alternatives and never both.
  const ceiling =
    w.base + w.signalFirm + w.quote + w.disproved + w.bothNamed + w.emailValid + w.phone + w.location;

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-gh-ink">Lead scoring</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gh-ink-secondary">
        What a lead is scored on, and how much each thing counts. The score sorts
        your lists; it is never shown to anyone you send a sheet to. Change
        anything here and every list re-sorts.
      </p>

      <div className="mt-3 rounded-xl border border-gh-border bg-gh-surface p-4">
        {!loaded ? (
          <p className="text-xs text-gh-ink-muted">Reading your settings…</p>
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {WEIGHT_LABELS.map(({ key, label, hint }) => (
                <label key={key} className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-gh-ink">{label}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-gh-ink-muted">
                      {hint}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={w[key]}
                    onChange={(e) =>
                      setW((prev) => ({
                        ...prev,
                        [key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      }))
                    }
                    aria-label={label}
                    // 16px on mobile, or iOS zooms in on focus and will not
                    // zoom back.
                    className="tabular w-16 shrink-0 rounded-lg border border-gh-border bg-gh-surface-sunken px-2 py-1.5 text-right text-base text-gh-ink focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/25 sm:text-sm"
                  />
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gh-border pt-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save(w)}
                className="cursor-pointer rounded-lg bg-gh-navy px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
              >
                {saving ? "Saving…" : saved ? "Saved ✓" : "Save scoring"}
              </button>
              <button
                type="button"
                disabled={saving || isDefault}
                onClick={() => void save({ reset: true })}
                className="cursor-pointer text-xs font-semibold text-gh-ink-muted underline-offset-2 transition-colors hover:text-gh-ink hover:underline disabled:opacity-40"
              >
                Back to the defaults
              </button>
              {/* A field edited alone says nothing about what it did to the
                  scale; the ceiling is what makes the numbers legible. */}
              <span className="tabular ml-auto text-[11px] text-gh-ink-muted">
                Best possible lead scores{" "}
                <strong className="font-semibold text-gh-ink">{Math.min(100, ceiling)}</strong>
                {ceiling > 100 && " (capped at 100)"}
              </span>
            </div>
            {error && <p className="mt-2 text-[11px] text-gh-critical">{error}</p>}
          </>
        )}
      </div>
    </section>
  );
}
