import { ZapIcon, UsersIcon, BuildingIcon } from "./icons";

/**
 * What the crawler is actually hunting for.
 *
 * Nothing in the product said this. The search form asked "Who are you looking
 * for?" and offered verticals, states and a revenue band — all of which
 * describe the COMPANY — while the one thing that makes this Signal Radar
 * rather than a business directory, the succession signal itself, was never
 * defined anywhere he could see it. The weekly harvest was worse: a panel that
 * schedules an automatic scan without saying what it scans for.
 *
 * Two conditions, both required, shown as conditions rather than explained as
 * prose. The AND between them is the whole product: a founder alone is just an
 * owner, and a next-gen alone is just an employee. Both, named, currently in
 * charge, on the company's own site — that is the moment he coaches.
 */
export function WhatCountsAsSignal({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-xl border border-gh-border bg-gh-surface-sunken p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
        <ZapIcon className="h-3.5 w-3.5 text-gh-lime" />
        What counts as a signal
      </p>

      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <Condition
          Icon={BuildingIcon}
          title="Founder still in charge"
          detail="named on the site, running it today"
        />
        {/* The AND, drawn rather than written. Both conditions or it is not a
            signal, and a plus sign says that faster than a sentence. */}
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center px-1 text-sm font-semibold text-gh-ink-muted sm:px-0"
        >
          +
        </span>
        <Condition
          Icon={UsersIcon}
          title="Next generation alongside"
          detail="son, daughter, named and active"
        />
      </div>

      {!compact && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-gh-ink-secondary">
          Both, in the company&rsquo;s own words, quoted so you can check it.
          Roughly one company in forty.
        </p>
      )}
    </div>
  );
}

function Condition({
  Icon,
  title,
  detail,
}: {
  Icon: (p: { className?: string }) => React.ReactElement;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex flex-1 items-start gap-2 rounded-lg bg-gh-surface px-3 py-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gh-navy" />
      <span className="min-w-0">
        <span className="block text-xs font-semibold leading-snug text-gh-ink">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-gh-ink-muted">{detail}</span>
      </span>
    </div>
  );
}
