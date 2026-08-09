"use client";

import { useRouter } from "next/navigation";
import { SearchFolder } from "@/lib/searches-store";
import { formatRelativeDate } from "@/lib/stats";
import { FolderIcon } from "./icons";

export function FolderCard({ folder }: { folder: SearchFolder }) {
  const router = useRouter();
  const isRunning = folder.status === "running";
  const isFailed = folder.status === "failed";
  // Two numbers, plain: how many leads this got, and how many of those carry a
  // real signal. The old card broke "got" into qualified / verify / fit-only —
  // three shades of the same idea that made a good run read like an audit.
  // 'leadsFound' is every accepted company (a 'signal'-mode run has no
  // fit-only, so the third term is simply zero there); 'withSignal' is the
  // subset actually backed by a signal.
  const leadsFound =
    folder.qualifiedCount + folder.verifyCount + folder.fitOnlyCount;
  const withSignal = folder.qualifiedCount + folder.verifyCount;
  // Keep the shortfall/cost math reading the same total the card now shows.
  const found = leadsFound;

  return (
    <button
      type="button"
      onClick={() => router.push(`/dashboard/lists/${folder.id}`)}
      className="group flex flex-col items-start rounded-xl border border-gh-border bg-gh-surface p-5 text-left transition-all hover:-translate-y-0.5 hover:border-gh-sky/40 hover:shadow-md"
    >
      <div className="flex w-full items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
          <FolderIcon className="h-4.5 w-4.5" />
        </span>
        <span className="tabular text-xs font-medium text-gh-ink-muted">
          {formatRelativeDate(folder.finishedAt ?? folder.createdAt)}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 font-display text-sm font-semibold leading-snug text-gh-ink group-hover:text-gh-navy">
        {folder.label}
      </p>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gh-ink-muted">
        {folder.query}
      </p>

      <div className="mt-4 flex w-full flex-wrap items-center gap-1.5">
        {isRunning ? (
          <StatChip value="Running…" label="" color="#0b5e85" bg="#e2f3fb" />
        ) : isFailed ? (
          <StatChip value="Failed" label="" color="#a3272a" bg="#fbdcdc" />
        ) : (
          <>
            <StatChip value={leadsFound} label="leads found" color="#0b7a0b" bg="#e2f6e2" />
            {withSignal > 0 && (
              <StatChip value={withSignal} label="with signal" color="#9a4a1f" bg="#fbe4d7" />
            )}
            {/* No "rejected" chip. This card is a summary of what he GOT, and
                the cut count was the widest number on it — a folder reading
                "1 lead found · 67 rejected" leads with the 67 and makes a good
                run look like a bad one. How much was checked lives in the
                folder itself. */}
          </>
        )}
      </div>

      {!isRunning && !isFailed && found < folder.targetSignals && (
        <p className="mt-2 text-[11px] text-gh-ink-muted">
          {folder.candidatesPoolExhausted
            ? `Ran out of new companies to check, ${found} of ${folder.targetSignals} requested`
            : `${found} of ${folder.targetSignals} requested`}
        </p>
      )}

      {/* What this folder cost, on the folder itself. It was recorded from the
          first run but only ever shown inside the folder, so the one question
          you cannot answer while looking at a wall of them — "which of these
          was expensive?" — needed opening every one. Cost per LEAD rather than
          cost per run, because $0.46 means nothing until you know whether it
          bought twelve leads or one. */}
      {!isRunning && folder.costEstimateUsd !== null && folder.costEstimateUsd > 0 && (
        <p className="tabular mt-2 text-[11px] text-gh-ink-muted">
          ~${folder.costEstimateUsd.toFixed(2)}
          {found > 0 && (
            <span className="opacity-70">
              {" "}
              · ${(folder.costEstimateUsd / found).toFixed(3)}/lead
            </span>
          )}
        </p>
      )}
    </button>
  );
}

function StatChip({
  value,
  label,
  color,
  bg,
}: {
  value: number | string;
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <span
      className="tabular inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color, background: bg }}
    >
      {value} {label && <span className="font-normal opacity-80">{label}</span>}
    </span>
  );
}
