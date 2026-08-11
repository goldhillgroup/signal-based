"use client";

import { useState } from "react";
import type { Company } from "@/lib/company";
import { copyCompaniesForSheets } from "@/lib/csv-export";
import { SheetIcon, CheckIcon } from "./icons";

/**
 * "Copy for Google Sheets" — the export people actually asked for.
 *
 * The CSV download already opens in Sheets, but only via Drive and File >
 * Import, and it arrives as a NEW spreadsheet. What is wanted is the rows in
 * the sheet already open, next to the notes and columns someone has added
 * themselves. Tab-separated text on the clipboard does exactly that: click a
 * cell, paste, and Sheets splits it into columns natively.
 *
 * No OAuth and no Google API on purpose. The alternative is asking a client to
 * authorise a third-party app against his own Drive, which is a much bigger
 * thing to ask than Cmd-V, and it would put this app inside his Google account
 * for a feature that is one paste.
 *
 * The confirmation says where to paste. "Copied" alone leaves someone looking
 * at a clipboard wondering whether it worked.
 */
export function SheetsButton({
  companies,
  className = "",
}: {
  companies: Company[];
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  async function copy() {
    const ok = await copyCompaniesForSheets(companies);
    setState(ok ? "done" : "failed");
    // Long enough to read the instruction, short enough that the button is
    // back to normal before anyone wants it again.
    setTimeout(() => setState("idle"), 4000);
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={copy}
        disabled={companies.length === 0}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gh-border bg-gh-surface px-3 py-1.5 text-xs font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      >
        {state === "done" ? (
          <CheckIcon className="h-3.5 w-3.5 text-gh-good" />
        ) : (
          <SheetIcon className="h-3.5 w-3.5" />
        )}
        {state === "done" ? "Copied" : "Copy for Google Sheets"}
        {state === "idle" && companies.length > 0 && (
          <span className="tabular font-normal text-gh-ink-muted">{companies.length}</span>
        )}
      </button>
      {state === "done" && (
        <span className="fade-in text-[11px] text-gh-ink-secondary">
          Open a sheet, click a cell, paste. It fills the columns for you.
        </span>
      )}
      {state === "failed" && (
        <span className="fade-in text-[11px] text-gh-critical">
          Your browser blocked the clipboard — use the CSV download instead.
        </span>
      )}
    </span>
  );
}
