"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

/**
 * One setting, shown as a readable line until you need to change it.
 *
 * WHY THE FORM NEEDED THIS. Every control was visible at once: three modes,
 * eight verticals wrapping onto two ragged rows, twelve states rendered as
 * twelve filled navy buttons, five revenue chips, five target chips, a
 * checkbox and a text field. Around forty controls, most of them already
 * correct, competing equally for attention. It read as a wall.
 *
 * The reason it can collapse at all is that the DEFAULTS ARE RIGHT: every
 * vertical, the agreed states, hybrid, the ICP sweet spot. Someone opening
 * this screen usually wants to press Search. Progressive disclosure is only
 * honest when the summary is complete — so `value` states the setting in
 * plain words ("All 8 verticals", "$5-15M (sweet spot)"), and nothing is
 * hidden behind a chevron that a person would need to open to know.
 *
 * Closed content is `inert`, so a collapsed section takes no tab stops and is
 * skipped by screen readers rather than being read out invisibly.
 */
export function SettingRow({
  label,
  value,
  children,
  defaultOpen = false,
}: {
  label: string;
  /** The current setting, in words. This is what makes opening optional. */
  value: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="border-b border-gh-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        // min-h-11 is the 44px touch target; the row is the hit area, not the
        // chevron, so there is nothing small to aim at.
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 py-2.5 text-left transition-colors duration-200 hover:text-gh-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
      >
        <span className="text-xs font-semibold text-gh-ink-secondary">{label}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-gh-ink">{value}</span>
          <ChevronDownIcon
            className={`h-3.5 w-3.5 shrink-0 text-gh-ink-muted transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      <div className="gh-collapse" data-open={open ? "true" : "false"} inert={!open}>
        <div>
          <div className="pb-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
