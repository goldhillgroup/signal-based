"use client";

import { CountUp } from "./CountUp";

/**
 * The four numbers, big, before any words.
 *
 * The page used to open with two sentences of explanation and put its figures
 * a screen down. That is backwards for a page called Overview: the question
 * on arrival is "where do things stand", which is a number, and prose asking
 * to be read before you get one is a toll booth.
 *
 * Counts animate up on mount. Not decoration — a number that arrives at rest
 * looks static and identical every visit, whereas one that climbs reads as
 * measured, and the eye lands on whichever finishes last.
 */

export interface HeroStat {
  label: string;
  value: number;
  /** Rendered ahead of the value, e.g. "$". */
  prefix?: string;
  /** Digits after the point. Money needs 2, counts need 0. */
  decimals?: number;
  hint: string;
  accent: string;
}

export function HeroStats({ stats }: { stats: HeroStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className="fade-up hover-spring relative overflow-hidden rounded-xl border border-gh-border bg-gh-surface p-4"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          {/* A wash of the stat's own colour, so the four tiles read as four
              different things at a glance rather than one grid of grey. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.09]"
            style={{ background: s.accent }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
            {s.label}
          </p>
          <p className="tabular mt-1.5 font-display text-3xl font-semibold leading-none text-gh-ink">
            {s.prefix}
            <CountUp value={s.value} decimals={s.decimals ?? 0} />
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-gh-ink-muted">{s.hint}</p>
        </div>
      ))}
    </div>
  );
}
