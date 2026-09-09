"use client";

import { useEffect, useRef, useState } from "react";
import { rankFor, RUNG_ORDER, DEFAULT_RULES } from "@/lib/lead-score";
import { ScorePill, verdictFor } from "./ScorePill";
import { setLocalMark } from "@/lib/use-marks";
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

  const systemScore = rankFor(company);

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
        // The list behind the drawer holds the same marks. Without this it
        // keeps showing the system's score until the page is reloaded, which
        // is the exact "I changed it and nothing moved" the shared store
        // exists to prevent.
        setLocalMark(company.id, { note: n || null, grade: g });
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

  const shown = grade ?? systemScore;
  const meaning = DEFAULT_RULES[RUNG_ORDER[RUNG_ORDER.length - shown]] ?? "";

  return (
    <div className="space-y-3">
      <div>
        {/* THE NUMBER, OUT OF FIVE, WITH WHAT IT MEANS UNDER IT.
            This has been a digit, then a sentence with the digit taken away,
            and neither on its own worked: "4" needs a legend, and a sentence
            alone cannot be scanned down a list or sorted. Both, always, and
            the same pair the lead list now shows. */}
        <div className="mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
            Your verdict
          </span>
          <div className="mt-1.5 flex items-center gap-2.5 rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-2">
            <ScorePill verdict={verdictFor(company, grade)} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug text-gh-ink">{meaning}</span>
              <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-gh-ink-muted">
                {grade === null ? "What the system found" : "Your call"}
              </span>
            </span>
          </div>
        </div>
        {/* THE SENTENCE THE SCORE CAME FROM. It always came from this -- the
            classifier's verdict on his description is what has_signal means --
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
            ? "Disagree? Give it your own 1 to 5. Yours then stands instead."
            : "Yours stands. Press it again to hand the lead back to the system."}
        </p>
        {/* FIVE BUTTONS, ONE PER NUMBER. They were five sentences, which made
            the panel a paragraph to read before you could disagree with it --
            and it is the number he is disagreeing with. The meaning of
            whichever is selected prints above, so nothing is lost. */}
        <div className="flex gap-1.5">
          {[5, 4, 3, 2, 1].map((n) => {
            const chosen = grade === n;
            const isSystem = grade === null && n === systemScore;
            return (
              <button
                key={n}
                type="button"
                disabled={saving}
                onClick={() => setGrade(chosen ? null : n)}
                aria-pressed={chosen}
                title={DEFAULT_RULES[RUNG_ORDER[RUNG_ORDER.length - n]]}
                className={`tabular flex-1 cursor-pointer rounded-lg border py-2 text-sm font-semibold transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                  chosen
                    ? "border-gh-navy bg-gh-navy text-white"
                    : isSystem
                      ? "border-gh-navy/40 text-gh-ink"
                      : "border-gh-border text-gh-ink-secondary hover:border-gh-navy/40 hover:text-gh-ink"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
        {grade === null && (
          <p className="mt-1 text-[10px] text-gh-ink-muted">
            {systemScore} is what the system gave it.
          </p>
        )}
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
