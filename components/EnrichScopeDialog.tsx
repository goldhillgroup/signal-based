"use client";

import { useState } from "react";
import { ENRICH_CEILING_PER_COMPANY_USD } from "@/lib/pipeline/pricing";
import type { EnrichScope } from "@/lib/enrich-scopes";

/**
 * Choose who to look up an email for, and confirm it, in one step.
 *
 * A CHECKLIST, NOT THREE BUTTONS. The first version offered pairs, fits, or
 * everything — which is three of the seven combinations, and left out the one
 * most likely to be wanted: pairs AND fits, without the rejected companies. The
 * three groups are disjoint, so ticking them composes cleanly and nothing is
 * ever counted twice.
 *
 * ONE PRICE, ON THE BUTTON. Three separate "~$0.39"s invited arithmetic to work
 * out what a combination would cost. The number that matters is the one about
 * to be spent, so it sits on the action, and it is stated as a ceiling — this
 * bills only for addresses actually FOUND, and a miss is free, so the real
 * figure is almost always lower.
 *
 * ONE COMPONENT because three places start enrichment and each had grown its
 * own version — two spending without asking at all. A fourth copy here would
 * have been the same mistake a fourth time.
 */
export function EnrichScopeDialog({
  open,
  folderLabel,
  scopes,
  onPick,
  onCancel,
}: {
  open: boolean;
  folderLabel: string;
  scopes: EnrichScope[];
  onPick: (ids: string[], everyPerson: boolean) => void;
  onCancel: () => void;
}) {
  const [everyPerson, setEveryPerson] = useState(false);

  // PAIRS AND FITS BY DEFAULT — every lead the search accepted. Pairs alone was
  // the old silent default and it is too narrow: a folder of 24 leads with no
  // confirmed pair would have opened with nothing ticked and nothing to do. The
  // cut companies stay opt-in, because arguing with a rejection is a deliberate
  // act rather than the normal case.
  const [picked, setPicked] = useState<Set<string>>(new Set(["pairs", "fits"]));

  if (!open) return null;

  const chosen = scopes.filter((s) => picked.has(s.key) && s.ids.length > 0);
  const ids = chosen.flatMap((s) => s.ids);
  const total = ids.length;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-gh-ink/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Choose who to find emails for"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-gh-border bg-gh-surface p-5 shadow-lg">
        <h3 className="font-display text-base font-semibold text-gh-ink">Find a personal email for who?</h3>
        <p className="mt-1 text-xs leading-relaxed text-gh-ink-muted">
          {folderLabel}. Pick any combination. It looks for the successor’s own
          address first where there is one, and never another office inbox.
        </p>

        <div className="mt-4 flex flex-col gap-1.5">
          {scopes.map((sc) => {
            const empty = sc.ids.length === 0;
            const on = picked.has(sc.key) && !empty;
            return (
              <label
                key={sc.key}
                // Empty groups stay VISIBLE and disabled rather than vanishing.
                // A folder with no confirmed pair is exactly the case where the
                // old single button quietly did nothing and reported success —
                // "Founder + successor  0" says so plainly.
                className={`flex min-h-11 items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors duration-200 ${
                  empty
                    ? "cursor-not-allowed border-gh-border bg-gh-surface-sunken opacity-40"
                    : on
                      ? "cursor-pointer border-gh-sky/50 bg-gh-sky/5"
                      : "cursor-pointer border-gh-border bg-gh-surface-sunken hover:border-gh-sky/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={empty}
                  onChange={() =>
                    setPicked((cur) => {
                      const next = new Set(cur);
                      if (next.has(sc.key)) next.delete(sc.key);
                      else next.add(sc.key);
                      return next;
                    })
                  }
                  className="h-4 w-4 shrink-0 accent-gh-sky"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gh-ink">{sc.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-gh-ink-muted">
                    {sc.hint}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm font-semibold text-gh-ink-secondary">
                  {sc.ids.length}
                </span>
              </label>
            );
          })}
        </div>

        {/* OFF BY DEFAULT, and priced honestly.
            A company with a founder and two sons is three lookups, not one, so
            this multiplies the bill by however many people are listed. The
            ceiling below cannot know that number without reading every
            company, so it says "per person" instead of pretending to a total
            it has not computed. Overstating certainty about a bill is worse
            than admitting the range. */}
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-gh-border p-2.5 text-xs">
          <input
            type="checkbox"
            checked={everyPerson}
            onChange={(e) => setEveryPerson(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-gh-sky"
          />
          <span className="text-gh-ink-secondary">
            <strong className="font-semibold text-gh-ink">Look up everyone</strong>, not
            just the person picked on each lead. One lookup per person, and on
            the leads tested so far the second person often came back with the
            same address as the first.
          </span>
        </label>

        <button
          type="button"
          disabled={total === 0}
          onClick={() => onPick(ids, everyPerson)}
          className="mt-4 min-h-11 w-full cursor-pointer rounded-lg bg-gh-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {total === 0 ? (
            "Pick at least one"
          ) : (
            <>
              Find a personal email for {total} {total === 1 ? "company" : "companies"}
              <span className="tabular ml-1.5 font-normal text-white/60">
                {everyPerson
                  ? `up to $${ENRICH_CEILING_PER_COMPANY_USD.toFixed(2)} per person`
                  : `up to $${(total * ENRICH_CEILING_PER_COMPANY_USD).toFixed(2)}`}
              </span>
            </>
          )}
        </button>
        <p className="mt-1.5 text-center text-[11px] leading-relaxed text-gh-ink-muted">
          Charged only for addresses actually found — a miss costs nothing, so it
          is usually less than this.
        </p>

        <button
          type="button"
          onClick={onCancel}
          className="mt-2 min-h-11 w-full cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-gh-ink-muted transition-colors hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
