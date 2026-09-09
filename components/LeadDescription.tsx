"use client";

import { useEffect, useState } from "react";
import { RUNG_ORDER, DEFAULT_RULES } from "@/lib/lead-score";

/**
 * The one setting behind the score.
 *
 * WHAT THIS REPLACED, and why three attempts got here. First a 0-100 built
 * from twelve weights, each settable -- machinery around a judgement rather
 * than the judgement. Then five numbers, one per rung. Then five editable
 * sentences. Every version asked him to configure the SCALE, and the scale was
 * never the thing he wanted to change: "he gives a description, and based on
 * the lead's info, from his description it's a 1 2 3 4 or 5, nothing complex."
 *
 * So there is one box. What comes out of it is a 1-5 that says how completely
 * a company matches what he typed, and the five rungs below it are shown as
 * fixed text, so the scale is legible without being another thing to maintain.
 *
 * IT ACTUALLY DRIVES THE SEARCH. This sentence becomes the default Signal
 * focus, which is what each site is read against. A description that only
 * relabelled a number would be a caption, not a setting.
 */
export function LeadDescription() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let off = false;
    fetch("/api/lead-description")
      .then((r) => r.json())
      .then((j) => {
        if (off) return;
        if (typeof j?.description === "string") {
          setText(j.description);
          setSaved(j.description);
        }
        setIsDefault(!!j?.isDefault);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      off = true;
    };
  }, []);

  async function commit(payload: { description: string } | { reset: true }) {
    setSaving(true);
    try {
      const res = await fetch("/api/lead-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (typeof j?.description === "string") {
        setText(j.description);
        setSaved(j.description);
        setIsDefault(!!j?.isDefault);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  const dirty = loaded && text.trim() !== saved.trim();

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-gh-ink">What a good lead looks like</h2>
      <p className="mt-0.5 mb-3 text-sm text-gh-ink-secondary">
        Describe the company you want to be called about. Every site the crawler
        reads is judged against this sentence, and how completely a company
        matches it is its score out of five.
      </p>

      <div className="rounded-xl border border-gh-border bg-gh-surface p-4">
        <label
          htmlFor="lead-description"
          className="text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted"
        >
          Your description
        </label>
        <textarea
          id="lead-description"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={300}
          disabled={!loaded || saving}
          placeholder="e.g. founder still leading with a son or daughter stepping up beside them"
          className="mt-1.5 w-full resize-y rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2 text-sm leading-relaxed text-gh-ink placeholder:text-gh-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:opacity-50"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => commit({ description: text })}
            className="cursor-pointer rounded-lg bg-gh-navy px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {dirty && (
            <button
              type="button"
              disabled={saving}
              onClick={() => setText(saved)}
              className="cursor-pointer rounded-lg border border-gh-border px-3 py-1.5 text-xs font-semibold text-gh-ink-secondary transition-colors hover:text-gh-ink"
            >
              Cancel
            </button>
          )}
          {!isDefault && !dirty && (
            <button
              type="button"
              disabled={saving}
              onClick={() => commit({ reset: true })}
              className="cursor-pointer text-xs font-medium text-gh-ink-muted underline-offset-2 hover:text-gh-ink hover:underline"
            >
              Put the original back
            </button>
          )}
          {justSaved && <span className="text-xs text-gh-good">Saved ✓</span>}
          <span className="ml-auto tabular text-[11px] text-gh-ink-muted">{text.length}/300</span>
        </div>

        <p className="mt-3 text-[11px] text-gh-ink-muted">
          It takes effect on the next search. Lists already on file keep the
          score they were given, because they were read against the old wording.
        </p>

        {/* THE SCALE, SHOWN AND NOT EDITABLE. It has to be legible -- a 3 means
            nothing without it -- but it is a description of how completely a
            company matched, which is not a thing to configure. */}
        <div className="mt-4 border-t border-gh-border pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
            How the five are counted
          </p>
          <ul className="mt-1.5 space-y-1">
            {RUNG_ORDER.map((k, i) => (
              <li key={k} className="flex gap-2 text-xs text-gh-ink-secondary">
                <span className="tabular w-3 shrink-0 font-semibold text-gh-ink">
                  {RUNG_ORDER.length - i}
                </span>
                <span>{DEFAULT_RULES[k]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
