"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A yes/no before something that costs money or cannot be undone.
 *
 * Deliberately not `window.confirm`: that one is unstyled, blocks the whole
 * thread, is suppressible by the browser, and cannot show the number that makes
 * the decision. The number is the entire point here — the difference between
 * enriching 1 signal and 83 leads is the difference between five cents and four
 * dollars, and that has to be readable at the moment of the click.
 *
 * Escape and backdrop both cancel, and cancel is what focus lands on. The
 * dangerous answer should never be the one you get by pressing Enter out of
 * habit.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  requirePhrase,
  destructive = false,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * When set, the confirm button stays disabled until this exact word is
   * typed. For actions where "are you sure?" is not enough because the answer
   * is reflexively yes — deleting a folder destroys leads AND the memory of
   * every company in it. Typing forces a second, deliberate reading.
   */
  requirePhrase?: string;
  /** Paints confirm red. Use only where the action genuinely removes data. */
  destructive?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");

  // Clear the typed phrase whenever the dialog opens, so a previous "DELETE"
  // can never arm the button for the NEXT folder. Adjusted during render
  // rather than in an effect, per React's own guidance for "state that needs
  // to change when a prop changes" — same pattern as FolderView.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped("");
  }

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const unlocked = !requirePhrase || typed.trim().toUpperCase() === requirePhrase.toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gh-navy-3/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="fade-up my-auto w-full max-w-sm rounded-2xl border border-gh-border bg-gh-surface p-6 shadow-2xl"
      >
        <p className="font-display text-base font-semibold text-gh-ink">{title}</p>
        <div className="mt-2 text-xs leading-relaxed text-gh-ink-secondary">{body}</div>

        {requirePhrase && (
          <div className="mt-4">
            <label
              htmlFor="confirm-phrase"
              className="block text-xs font-medium text-gh-ink-secondary"
            >
              Type <strong className="font-semibold text-gh-ink">{requirePhrase}</strong> to
              continue
            </label>
            <input
              id="confirm-phrase"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={requirePhrase}
              // 16px so iOS Safari does not zoom the page on focus and then
              // refuse to zoom back out.
              className="mt-1.5 w-full rounded-lg border border-gh-border bg-gh-surface-sunken px-3 py-2.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/30 sm:text-sm"
            />
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-gh-border bg-gh-surface-sunken py-2.5 text-xs font-semibold text-gh-ink-secondary transition-colors duration-200 hover:border-gh-sky/40 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!unlocked}
            className={`flex-1 rounded-xl py-2.5 text-xs font-semibold text-white transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40 ${
              destructive ? "bg-gh-critical hover:opacity-90" : "bg-gh-navy hover:bg-gh-navy-2"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
