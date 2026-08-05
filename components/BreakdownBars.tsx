"use client";

import { useState } from "react";

interface Row {
  key: string;
  label: string;
  color: string;
  count: number;
  pct: number;
  description?: string;
}

export function BreakdownBars({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const isHover = hover === row.key;
        return (
          <div
            key={row.key}
            className="group relative rounded-lg px-1.5 py-1 transition-colors"
            style={{
              background: isHover ? "var(--gh-surface-sunken)" : "transparent",
            }}
            onMouseEnter={() => setHover(row.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(row.key)}
            onBlur={() => setHover(null)}
            tabIndex={row.description ? 0 : -1}
          >
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-gh-ink">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: row.color }}
                />
                {row.label}
              </span>
              <span className="tabular font-semibold text-gh-ink-secondary">
                {row.count}
                <span className="ml-1 font-normal text-gh-ink-muted">
                  ({row.pct}%)
                </span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gh-surface-sunken">
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${(row.count / max) * 100}%`,
                  background: row.color,
                }}
              />
            </div>
            {isHover && row.description && (
              <div className="pointer-events-none absolute -top-9 left-1.5 z-10 rounded-lg border border-gh-border bg-gh-navy px-2.5 py-1.5 text-xs text-white shadow-lg">
                <p className="max-w-[220px] text-white/85">{row.description}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
