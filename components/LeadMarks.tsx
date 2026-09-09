"use client";

import { useEffect, useRef, useState } from "react";
import { starMeaning, rungFor, RUNG_ORDER, type ScoreRules } from "@/lib/lead-score";
import { useScoreRules } from "@/lib/use-score-rules";
import type { Company } from "@/lib/company";

/**
 * Jonathan's own note and his own 1-5, on every lead.
 *
 * HIS SCORE WINS. That was the ask, and it is the right way round: the system
 * grades the evidence it could read off a page, and he has spoken to these
 * people. The system's number stays visible beside his so a disagreement is
 * legible rather than silently overwritten -- if he keeps marking 5s where the
 * system says 2, that is worth knowing about the scoring.
 *
 * NOTHING SAVES UNTIL YOU PRESS SAVE, matching the people editor.
 *
 * This saved on blur for a day, on the argument that losing a half-typed note
 * to a stray click is worse than saving one too eagerly. Daniel asked for the
 * explicit version here too, and consistency is the stronger argument: two
 * panels in the same drawer, one committing silently and one holding a draft,
 * is a coin flip every time somebody types. Leaving with unsaved work asks,
 * the way it does upstairs.
 */
export function LeadMarks({
  company,
  judgedAgainst,
  onDirtyChange,
}: {
  company: Company;
  /**
   * The signal-focus sentence this lead was judged against.
   *
   * The score has always come from it -- has_signal IS the classifier's
   * verdict on that sentence -- and the panel never said so, which made the
   * number look like an opinion of its own.
   */
  judgedAgainst?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  // Draft and saved, kept apart, so "is there unsaved work" is answerable and
  // Cancel can mean something.
  const [note, setNote] = useState("");
  const [grade, setGrade] = useState<number | null>(null);
  const [savedNote, setSavedNote] = useState("");
  const [savedGrade, setSavedGrade] = useState<number | null>(null);
  // WHICH lead the loaded values belong to, rather than a boolean flipped
  // synchronously inside the effect. Setting state in an effect body triggers
  // a cascading render, and the question being asked is "are these values for
  // the company on screen" -- which an id answers and a boolean does not.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedAt = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rules = useScoreRules();
  const systemRung = rungFor(company);

  useEffect(() => {
    let off = false;
    fetch(`/api/company/${company.id}/marks`)
      .then((r) => r.json())
      .then((j) => {
        if (off) return;
        const n = j?.note ?? "";
        const g = typeof j?.grade === "number" ? j.grade : null;
        setNote(n);
        setSavedNote(n);
        setGrade(g);
        setSavedGrade(g);
        setLoadedFor(company.id);
      })
      .catch(() => setLoadedFor(company.id));
    return () => {
      off = true;
    };
  }, [company.id]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/company/${company.id}/marks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, grade }),
      });
      const j = await res.json();
      if (res.ok) {
        const n = j?.note ?? "";
        const g = typeof j?.grade === "number" ? j.grade : null;
        setNote(n);
        setSavedNote(n);
        setGrade(g);
        setSavedGrade(g);
        setSaved(true);
        if (savedAt.current) clearTimeout(savedAt.current);
        savedAt.current = setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setNote(savedNote);
    setGrade(savedGrade);
  }

  const loaded = loadedFor === company.id;
  const dirty = loaded && (note.trim() !== savedNote.trim() || grade !== savedGrade);

  // The drawer refuses to close on unsaved work, and it needs telling.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current !== dirty) {
      dirtyRef.current = dirty;
      onDirtyChange?.(dirty);
    }
  });
  if (!loaded) {
    return <p className="text-xs text-gh-ink-muted">Reading your notes…</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        {/* THE SYSTEM'S NUMBER, LEGIBLE, AND OUT OF FIVE.
            It was 11px inline text reading "System says 4", which is both easy
            to miss and ambiguous -- 4 out of what? The scale has to be on the
            number or the number means nothing. */}
        <div className="mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
            Your verdict
          </span>
          {/* THE SENTENCE, NOT A DIGIT. "1 to 5" is how many rungs there are,
              not what a lead should be called. A 3 beside a company name says
              nothing without a legend to decode it against. */}
          <p className="mt-1.5 rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-2 text-sm font-medium leading-snug text-gh-ink">
            {starMeaning(company, rules)}
            <span className="mt-0.5 block text-[10px] font-normal uppercase tracking-wide text-gh-ink-muted">
              What the system found
            </span>
          </p>
        </div>
        {/* THE SENTENCE THE SCORE CAME FROM. It always came from this -- the
            classifier's verdict on his signal focus is what has_signal means --
            and the panel never said so, which left the number looking like an
            opinion of its own rather than an answer to his own question. */}
        {judgedAgainst && (
          <p className="mb-2 rounded-lg bg-gh-surface-sunken px-2.5 py-1.5 text-[11px] leading-relaxed text-gh-ink-muted">
            Scored against what you asked for:{" "}
            <span className="text-gh-ink-secondary">&ldquo;{judgedAgainst}&rdquo;</span>
          </p>
        )}
        <p className="mb-1.5 text-[11px] text-gh-ink-muted">
          {grade === null
            ? "Disagree? Pick the one that fits. Yours then stands instead."
            : "Yours stands. Click it again to hand the lead back to the system."}
        </p>
        <div className="space-y-1">
          {RUNG_ORDER.map((k, i) => {
            const n = RUNG_ORDER.length - i;
            const chosen = grade === n;
            return (
              <button
                key={k}
                type="button"
                disabled={saving}
                onClick={() => setGrade(chosen ? null : n)}
                aria-pressed={chosen}
                className={`block w-full cursor-pointer rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                  chosen
                    ? "border-gh-navy bg-gh-navy font-semibold text-white"
                    : "border-gh-border text-gh-ink-secondary hover:border-gh-navy/40 hover:text-gh-ink"
                }`}
              >
                {(rules as ScoreRules)[k]}
                {k === systemRung && !chosen && (
                  <span className="ml-1.5 text-[10px] text-gh-ink-muted">what the system said</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
            Notes
          </span>
          {saving ? (
            <span className="text-[11px] text-gh-ink-muted">Saving…</span>
          ) : saved ? (
            <span className="text-[11px] text-gh-good">Saved ✓</span>
          ) : null}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="What you know about this one that the page does not say."
          aria-label="Your notes on this lead"
          // 16px on mobile, or iOS zooms in on focus and will not zoom back.
          className="w-full resize-y rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-2 text-base leading-relaxed text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/25 sm:text-sm"
        />
        <p className="mt-1 text-[10px] text-gh-ink-muted">Exports with the lead.</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void save()}
            className="cursor-pointer rounded-lg bg-gh-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            {saving ? "Saving…" : saved && !dirty ? "Saved ✓" : "Save"}
          </button>
          {dirty && (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={discard}
                className="cursor-pointer text-[11px] text-gh-ink-muted underline-offset-2 hover:underline"
              >
                Cancel
              </button>
              <span className="text-[10px] font-semibold text-gh-warning">unsaved changes</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
