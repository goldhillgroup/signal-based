"use client";

import { useEffect } from "react";
import type { SearchFolder } from "@/lib/searches-store";
import { UsersIcon } from "./icons";

/**
 * Enrichment's own progress dialog, matching SearchProgress.
 *
 * Enrichment used to report itself with the word "Enriching…" on a disabled
 * button and nothing else — no count, no percentage, no sign of life, for a job
 * that runs minutes on the server. Reported as "I clicked and nothing
 * happened", while it was in fact finding contacts the whole time.
 *
 * Same shape as the search dialog on purpose. These are the only two long jobs
 * in the app and they should not need to be learned twice.
 */

export function EnrichProgress({
  folder,
  target,
  onDismiss,
}: {
  folder: SearchFolder;
  /** Companies in scope for this run — the denominator. */
  target: number;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const found = folder.contactsFound;
  const verified = folder.contactsVerified;
  const done = folder.enrichmentStatus !== "running";
  // Against companies looked up, not emails found — the vendor does not find
  // one every time (41% came back empty on the last real run), so a bar scaled
  // to "found" would stall short of 100% on a perfectly successful job.
  const pct = Math.min(100, Math.round((found / Math.max(target, 1)) * 100));

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gh-navy-3/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Looking up contacts"
        className="scale-in my-auto w-full max-w-md rounded-2xl border border-gh-border bg-gh-surface p-7 shadow-2xl"
      >
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
          {!done && (
            <>
              <span
                className="ping-ring absolute rounded-full border border-gh-sky"
                style={{ width: 80, height: 80, "--gh-ring-opacity": 0.12, "--gh-ring-delay": "600ms" } as React.CSSProperties}
              />
              <span
                className="ping-ring absolute rounded-full border border-gh-sky"
                style={{ width: 56, height: 56, "--gh-ring-opacity": 0.2, "--gh-ring-delay": "300ms" } as React.CSSProperties}
              />
            </>
          )}
          <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gh-navy text-white shadow-lg">
            <UsersIcon className="h-5 w-5" />
          </span>
        </div>

        <p className="mt-5 text-center text-xs font-medium text-gh-ink-muted">
          {done ? "Finished looking up" : "Looking up contacts for"}
        </p>
        <p className="mt-1 text-center text-sm font-semibold leading-snug text-gh-ink">
          {folder.label}
        </p>

        <div className="mt-6">
          <div className="flex items-baseline justify-center gap-1.5">
            <span className="tabular font-display text-3xl font-semibold text-gh-ink">{found}</span>
            <span className="text-sm text-gh-ink-muted">/ {target} emails</span>
          </div>
          <div className="mx-auto mt-3 max-w-[240px]">
            <div className="h-2 overflow-hidden rounded-full bg-gh-surface-sunken">
              <div
                className="h-full rounded-full bg-gh-sky transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="tabular mt-1.5 text-center text-[11px] font-semibold text-gh-ink-secondary">
              {pct}%
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-gh-surface-sunken px-3 py-2.5 text-center">
          <p className="text-xs font-semibold text-gh-ink">
            {done ? "Done" : "Checking each company in turn"}
          </p>
          <p className="tabular mt-0.5 text-[11px] text-gh-ink-secondary">
            {verified} confirmed deliverable
          </p>
        </div>

        {/* Not every company has a findable address, and that is normal rather
            than a fault. Saying so here stops a 60% result reading as a 40%
            failure. */}
        <p className="mt-3 text-center text-[11px] leading-relaxed text-gh-ink-muted">
          {done
            ? "You are only charged for the addresses that were found."
            : "Not every company has a findable email. You are only charged for the ones found."}
        </p>

        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 w-full rounded-xl border border-gh-border bg-gh-surface-sunken py-2.5 text-xs font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink"
        >
          {done ? "Close" : "Let it run, I’ll check back later"}
        </button>
        {!done && (
          <p className="mt-2 text-center text-[11px] text-gh-ink-muted">
            Keeps running if you close this or leave the page.
          </p>
        )}
      </div>

      <style>{`
        @keyframes gh-ping {
          0% { transform: scale(0.7); opacity: 0.4; }
          80%, 100% { transform: scale(1.3); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
