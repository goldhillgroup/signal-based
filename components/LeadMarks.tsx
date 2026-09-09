"use client";

import { useEffect, useRef, useState } from "react";
import { starsFor, STAR_LABEL } from "@/lib/lead-score";
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
  onDirtyChange,
}: {
  company: Company;
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

  const system = starsFor(company);

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
        <div className="mb-2 flex items-start justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
            Your score
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-gh-ink-muted">
              System says
            </span>
            <span className="tabular font-display text-xl font-semibold leading-none text-gh-ink">
              {system}
              <span className="text-sm font-normal text-gh-ink-muted"> / 5</span>
            </span>
            <span className="mt-0.5 block text-[10px] text-gh-ink-muted">{STAR_LABEL[system]}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={saving}
              onClick={() => setGrade(grade === n ? null : n)}
              aria-pressed={grade === n}
              title={grade === n ? "Click again to go back to the system's score" : `Score this ${n}`}
              className={`h-7 w-7 cursor-pointer rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                grade === n
                  ? "border-gh-navy bg-gh-navy text-white"
                  : "border-gh-border text-gh-ink-secondary hover:border-gh-navy/40 hover:text-gh-ink"
              }`}
            >
              {n}
            </button>
          ))}
          {grade !== null && (
            <span className="ml-1.5 text-[11px] font-semibold text-gh-navy">
              Yours wins: {grade} / 5
            </span>
          )}
          {grade === null && (
            <span className="ml-1.5 text-[11px] text-gh-ink-muted">
              Not scored, so the system&rsquo;s stands
            </span>
          )}
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
