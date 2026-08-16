"use client";

import { useState } from "react";

interface TrendPoint {
  date: string;
  count: number;
}

const W = 640;
const H = 180;
// ROOM FOR THE VALUE LABEL, which is why this is not 12.
//
// The tallest bar is drawn to exactly y = PAD_TOP, and its count is printed at
// y - 6 in a 10px font. At 12 the glyphs started around y = -1, so the number
// over the tallest bar -- the one bar whose value is always worth reading --
// was sliced in half by the top of the viewBox. 22 clears the ascender.
const PAD_TOP = 22;
const PAD_BOTTOM = 24;
const PAD_X = 4;

export function SignalTrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...data.map((d) => d.count));
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const n = data.length;
  const slot = (W - PAD_X * 2) / n;
  const barW = Math.min(20, slot - 3);

  const maxIdx = data.reduce(
    (best, d, i) => (d.count > data[best].count ? i : best),
    0
  );

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label="Daily signal detection volume"
      >
        {/* baseline */}
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={H - PAD_BOTTOM}
          y2={H - PAD_BOTTOM}
          stroke="var(--gh-border-strong)"
          strokeWidth={1}
        />

        {data.map((d, i) => {
          const x = PAD_X + i * slot + (slot - barW) / 2;
          const h = Math.max(2, (d.count / max) * plotH);
          const y = H - PAD_BOTTOM - h;
          const isHover = hover === i;
          const isMax = i === maxIdx;
          const showEveryNth = n > 20 ? 5 : n > 10 ? 3 : 1;

          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={4}
                fill={
                  isHover
                    ? "var(--gh-seq-600)"
                    : isMax
                      ? "var(--gh-seq-500)"
                      : "var(--gh-seq-300)"
                }
                className="transition-colors"
              />
              {/* invisible, generous hit target */}
              <rect
                x={PAD_X + i * slot}
                y={PAD_TOP}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h2) => (h2 === i ? null : h2))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h2) => (h2 === i ? null : h2))}
                tabIndex={0}
              />
              {i % showEveryNth === 0 && (
                <text
                  x={x + barW / 2}
                  y={H - PAD_BOTTOM + 14}
                  textAnchor="middle"
                  className="fill-gh-ink-muted"
                  style={{ fontSize: 9 }}
                >
                  {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </text>
              )}
              {isMax && (
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  className="fill-gh-ink-secondary"
                  style={{ fontSize: 10, fontWeight: 700 }}
                >
                  {d.count}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-gh-border bg-gh-navy px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{
            left: `${((PAD_X + hover * slot + slot / 2) / W) * 100}%`,
            top: `${((H - PAD_BOTTOM - Math.max(2, (data[hover].count / max) * plotH)) / H) * 100 - 2}%`,
          }}
        >
          <p className="font-semibold tabular">
            {data[hover].count} signal{data[hover].count === 1 ? "" : "s"}
          </p>
          <p className="text-white/60">
            {new Date(data[hover].date + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      )}
    </div>
  );
}
