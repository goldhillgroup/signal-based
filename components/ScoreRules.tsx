"use client";

import { useEffect, useState } from "react";
import { DEFAULT_RULES, RULE_LABELS, type ScoreRules } from "@/lib/lead-score";

/**
 * What each rung of the 1-5 is worth.
 *
 * FIVE NUMBERS, not twelve weights. A previous version made every input to the
 * score settable and that was machinery around a judgement -- rightly cut. But
 * cutting it took the whole thing out of Settings, which was an over-
 * correction: the rules ARE his qualification and he is entitled to disagree
 * with where they land. Whether a pair with no quote is a 4 or a 3 is a real
 * argument. How many points a phone number earns is not.
 */
export function ScoreRulesCard() {
  const [rules, setRules] = useState<ScoreRules>(DEFAULT_RULES);
  const [loaded, setLoaded] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let off = false;
    fetch("/api/score-rules")
      .then((r) => r.json())
      .then((j) => {
        if (off) return;
        if (j?.rules) setRules(j.rules);
        setIsDefault(!!j?.isDefault);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      off = true;
    };
  }, []);

  async function save(next: ScoreRules | { reset: true }) {
    setSaving(true);
    try {
      const res = await fetch("/api/score-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("reset" in next ? { reset: true } : { rules: next }),
      });
      const j = await res.json();
      if (res.ok) {
        setRules(j.rules);
        setIsDefault(!!j.isDefault);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-gh-ink">Lead scoring</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gh-ink-secondary">
        Every lead gets a 1 to 5 from what the crawler could show about it. These
        are the five situations and what each one scores. Your own score on a
        lead always beats this.
      </p>

      <div className="mt-3 rounded-xl border border-gh-border bg-gh-surface p-4">
        {!loaded ? (
          <p className="text-xs text-gh-ink-muted">Reading your settings…</p>
        ) : (
          <>
            <div className="space-y-2.5">
              {RULE_LABELS.map(({ key, label, hint }) => (
                <div key={key} className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-gh-ink">{label}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-gh-ink-muted">
                      {hint}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={saving}
                        aria-pressed={rules[key] === n}
                        aria-label={`${label}: ${n}`}
                        onClick={() => setRules((r) => ({ ...r, [key]: n }))}
                        className={`h-7 w-7 cursor-pointer rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                          rules[key] === n
                            ? "border-gh-navy bg-gh-navy text-white"
                            : "border-gh-border text-gh-ink-secondary hover:border-gh-navy/40 hover:text-gh-ink"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gh-border pt-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save(rules)}
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
                Back to 5 4 3 2 1
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
