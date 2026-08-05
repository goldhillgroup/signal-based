import {
  CONFIDENCE_META,
  STATUS_META,
  FIND_STATUS_META,
  VERIFICATION_META,
  INDUSTRY_META,
} from "@/lib/signal-meta";
import type {
  Confidence,
  CompanyStatus,
  FindStatus,
  VerificationStatus,
  Industry,
} from "@/lib/supabase/types";
import { DotIcon } from "./icons";

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const meta = CONFIDENCE_META[confidence];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color: meta.color, background: meta.bg }}
      title={meta.description}
    >
      <DotIcon className="h-1.5 w-1.5" />
      {meta.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: CompanyStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color: meta.color, background: meta.bg }}
    >
      {meta.label}
    </span>
  );
}

export function FindStatusBadge({ status }: { status: FindStatus }) {
  const meta = FIND_STATUS_META[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color: meta.color, background: meta.bg }}
    >
      {meta.label}
    </span>
  );
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const meta = VERIFICATION_META[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color: meta.color, background: meta.bg }}
    >
      {meta.label}
    </span>
  );
}

export function IndustryChip({ industry }: { industry: Industry }) {
  const meta = INDUSTRY_META[industry];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gh-ink-secondary">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
        style={{ background: meta.color }}
      />
      {meta.label}
    </span>
  );
}
