"use client";

import { useState } from "react";
import { DownloadIcon, CheckIcon } from "./icons";

/**
 * Download the leads as a formatted spreadsheet.
 *
 * Alongside the CSV rather than replacing it. A CSV opens anywhere and is the
 * right answer when somebody just wants the rows; this is the one that arrives
 * looking like something -- header locked and filtered, cut rows tinted,
 * verdict coloured, links clickable, and an empty remarks column left for
 * writing in.
 *
 * Built server-side (see app/api/export/xlsx/route.ts), so the megabyte of
 * spreadsheet library never reaches the browser.
 */
export function XlsxButton({
  searchId,
  count,
  className = "",
}: {
  /** Omit for every lead across every list. */
  searchId?: string;
  count: number;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">("idle");

  async function download() {
    setState("working");
    try {
      const res = await fetch("/api/export/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchId ? { searchId } : {}),
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "leads.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoked on the next tick, not immediately: Safari cancels a download
      // whose object URL is released in the same frame as the click.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 4000);
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={count === 0 || state === "working"}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gh-border bg-gh-surface px-3 py-1.5 text-xs font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/40 hover:text-gh-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${className}`}
    >
      {state === "done" ? (
        <CheckIcon className="h-3.5 w-3.5 text-gh-good" />
      ) : (
        <DownloadIcon className="h-3.5 w-3.5" />
      )}
      {state === "working"
        ? "Building…"
        : state === "done"
          ? "Downloaded"
          : state === "failed"
            ? "That did not work"
            : "Excel"}
      {state === "idle" && count > 0 && (
        <span className="tabular font-normal text-gh-ink-muted">{count}</span>
      )}
    </button>
  );
}
