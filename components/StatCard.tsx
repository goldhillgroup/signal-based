import { ComponentType } from "react";

export function StatCard({
  label,
  value,
  suffix,
  subtext,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  subtext: string;
  icon: ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-gh-border bg-gh-surface p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gh-ink-muted">
          {label}
        </p>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: `${accent}1a`, color: accent }}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="tabular mt-3 font-display text-3xl font-semibold text-gh-ink">
        {value}
        {suffix && (
          <span className="ml-1 text-lg font-medium text-gh-ink-muted">
            {suffix}
          </span>
        )}
      </p>
      <p className="mt-1.5 text-xs text-gh-ink-secondary">{subtext}</p>
    </div>
  );
}
