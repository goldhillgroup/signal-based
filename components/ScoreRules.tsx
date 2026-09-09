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
        Five situations, described below. A lead is labelled with whatever you
        write for the one it lands in, so change the wording and every lead
        re-labels. Your own verdict on a lead always beats this.
      </p>

      <div className="mt-3 rounded-xl border border-gh-border bg-gh-surface p-4">
        {!loaded ? (
          <p className="text-xs text-gh-ink-muted">Reading your settings…</p>
        ) : (
          <>
            <div className="space-y-3">
              {RULE_LABELS.map(({ key, hint }) => (
                <div key={key}>
                  <p className="mb-1 text-[11px] leading-relaxed text-gh-ink-muted">{hint}</p>
                  <input
                    value={rules[key]}
                    onChange={(e) => setRules((r) => ({ ...r, [key]: e.target.value }))}
                    maxLength={80}
                    aria-label={hint}
                    // 16px on mobile, or iOS zooms in on focus and will not
                    // zoom back.
                    className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-1.5 text-base text-gh-ink focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/25 sm:text-sm"
                  />
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
                Back to the default wording
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
