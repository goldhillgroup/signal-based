"use client";

import { useRouter } from "next/navigation";
import { SearchFolder } from "@/lib/searches-store";
import { formatRelativeDate } from "@/lib/stats";
import { FolderIcon } from "./icons";

export function FolderCard({ folder }: { folder: SearchFolder }) {
  const router = useRouter();
  const isRunning = folder.status === "running";
  const isFailed = folder.status === "failed";

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
            <StatChip value={folder.qualifiedCount} label="qualified" color="#0b7a0b" bg="#e2f6e2" />
            <StatChip value={folder.verifyCount} label="verify" color="#9a4a1f" bg="#fbe4d7" />
            <StatChip value={folder.rejectedCount} label="rejected" color="#8892a0" bg="var(--gh-surface-sunken)" />
          </>
        )}
      </div>
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
