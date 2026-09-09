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
 * SAVED ON BLUR, unlike the people editor, which holds a draft until Done.
 * The difference is what a mistake costs. A half-typed name gets bought an
 * email address; a half-typed note is a half-typed note, and losing one
 * because he clicked away is the worse failure here.
 */
export function LeadMarks({ company }: { company: Company }) {
  const [note, setNote] = useState("");
  const [grade, setGrade] = useState<number | null>(null);
  // WHICH lead the loaded values belong to, rather than a boolean flipped
  // synchronously inside the effect. Setting state in an effect body triggers
  // a cascading render, and the question being asked is "are these values for
  // the company on screen" -- which an id answers and a boolean does not.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const original = useRef("");

  const system = starsFor(company);

  useEffect(() => {
    let off = false;
    fetch(`/api/company/${company.id}/marks`)
      .then((r) => r.json())
      .then((j) => {
        if (off) return;
        setNote(j?.note ?? "");
        original.current = j?.note ?? "";
        setGrade(typeof j?.grade === "number" ? j.grade : null);
        setLoadedFor(company.id);
      })
      .catch(() => setLoadedFor(company.id));
    return () => {
      off = true;
    };
  }, [company.id]);

  async function save(patch: { note?: string | null; grade?: number | null }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/company/${company.id}/marks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (res.ok) {
        setNote(j?.note ?? "");
        original.current = j?.note ?? "";
        setGrade(typeof j?.grade === "number" ? j.grade : null);
        setSaved(true);
        if (savedAt.current) clearTimeout(savedAt.current);
        savedAt.current = setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  const loaded = loadedFor === company.id;
  if (!loaded) {
    return <p className="text-xs text-gh-ink-muted">Reading your notes…</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
            Your score
          </span>
          <span className="text-[11px] text-gh-ink-muted">
            {/* Shown, not hidden. A disagreement between the two is
                information about the scoring, not an embarrassment. */}
            System says <strong className="font-semibold text-gh-ink">{system}</strong> ·{" "}
            {STAR_LABEL[system]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={saving}
              onClick={() => void save({ grade: grade === n ? null : n })}
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
              Yours wins ({grade})
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
          onBlur={() => {
            if (note.trim() === original.current.trim()) return;
            void save({ note });
          }}
          rows={3}
          maxLength={4000}
          placeholder="What you know about this one that the page does not say."
          aria-label="Your notes on this lead"
          // 16px on mobile, or iOS zooms in on focus and will not zoom back.
          className="w-full resize-y rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-2 text-base leading-relaxed text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/25 sm:text-sm"
        />
        <p className="mt-1 text-[10px] text-gh-ink-muted">
          Saves when you click away. Exports with the lead.
        </p>
      </div>
    </div>
  );
}
