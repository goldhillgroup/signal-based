"use client";

import { ENRICH_CEILING_PER_COMPANY_USD } from "@/lib/pipeline/pricing";
import type { EnrichScope } from "@/lib/enrich-scopes";

/**
 * Choose who to look up an email for, and confirm it, in one step.
 *
 * ONE COMPONENT because there are three places to start enrichment and every
 * one of them had grown its own version. Two decided for you without asking,
 * the third offered two choices where there are three, and the middle option
 * re-bought the pairs you had already paid for. Writing a fourth copy here
 * would have been the same mistake a fourth time.
 *
 * Every scope shows its own count and its own price, because they differ by an
 * order of magnitude and the choice is a spending decision. A scope with
 * nothing in it stays VISIBLE and disabled rather than disappearing: a folder
 * with no confirmed pair is exactly the case where the old buttons quietly did
 * nothing and reported success, and "Only the 0 pairs, ~$0.00" says so.
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
  onPick: (ids: string[]) => void;
  onCancel: () => void;
}) {
  if (!open) return null;

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
        <h3 className="font-display text-base font-semibold text-gh-ink">Find emails for who?</h3>
        <p className="mt-1 text-xs leading-relaxed text-gh-ink-muted">
          {folderLabel}. Billed only for addresses actually found, and it looks up
          the successor first where there is one.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {scopes.map((sc) => (
            <button
              key={sc.key}
              type="button"
              disabled={sc.ids.length === 0}
              onClick={() => onPick(sc.ids)}
              className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-gh-border bg-gh-surface-sunken px-3.5 py-2.5 text-left transition-colors duration-200 hover:border-gh-sky/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gh-ink">{sc.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-gh-ink-muted">
                  {sc.hint}
                </span>
              </span>
              <span className="tabular shrink-0 text-xs font-semibold text-gh-ink-secondary">
                ~${(sc.ids.length * ENRICH_CEILING_PER_COMPANY_USD).toFixed(2)}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 min-h-11 w-full cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-gh-ink-muted transition-colors hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
