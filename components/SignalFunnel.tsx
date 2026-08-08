"use client";

import Link from "next/link";
import { CountUp } from "./CountUp";
import { SearchIcon, BuildingIcon, ZapIcon, UsersIcon } from "./icons";

/**
 * The pipeline as a living diagram rather than four paragraphs.
 *
 * It is a FUNNEL, and that is the whole point: 478 read → 112 fit → 14 signal
 * → 9 contacts. Every number is smaller than the one before it, and seeing
 * that shape in one glance explains "why is qualified so much bigger than
 * signals?" faster than any wording could. The text version of this section
 * needed ~90 words to say less.
 *
 * Travelling dashes on the connectors carry the sense of flow; the halo pulses
 * only on the stage that is genuinely the product's payload (signals). Both
 * are switched off under prefers-reduced-motion in globals.css.
 */

interface Stage {
  key: string;
  label: string;
  count: number;
  href: string;
  color: string;
  bg: string;
  icon: (p: { className?: string }) => React.ReactElement;
}

export function SignalFunnel({
  scanned,
  icpFit,
  signals,
  contacts,
}: {
  scanned: number;
  icpFit: number;
  signals: number;
  contacts: number;
}) {
  const stages: Stage[] = [
    {
      key: "read",
      label: "Read",
      count: scanned,
      href: "/dashboard",
      color: "var(--gh-navy)",
      bg: "rgba(0,26,87,0.07)",
      icon: SearchIcon,
    },
    {
      key: "fit",
      label: "Fit the ICP",
      count: icpFit,
      href: "/dashboard/all-leads",
      color: "var(--gh-sky)",
      bg: "rgba(15,165,225,0.12)",
      icon: BuildingIcon,
    },
    {
      key: "signal",
      label: "Real signals",
      count: signals,
      href: "/dashboard/all-leads",
      color: "#5f8a00",
      bg: "rgba(179,209,55,0.22)",
      icon: ZapIcon,
    },
    {
      key: "contact",
      label: "Contacts",
      count: contacts,
      href: "/dashboard/all-leads",
      color: "var(--gh-orange)",
      bg: "rgba(239,139,25,0.14)",
      icon: UsersIcon,
    },
  ];

  return (
    <div className="rounded-2xl border border-gh-border bg-gh-surface px-3 py-5 sm:px-6">
      <div className="flex items-center">
        {stages.map((stage, i) => {
          const Icon = stage.icon;
          return (
            <div key={stage.key} className="contents">
              <Link
                href={stage.href}
                aria-label={`${stage.label}: ${stage.count}`}
                className="hover-spring group flex shrink-0 flex-col items-center gap-1.5 rounded-lg px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 sm:px-2"
              >
                <div className="relative">
                  {/* Only the payload stage pulses — a halo on all four would
                      be decoration, and decoration that never stops is noise. */}
                  {stage.key === "signal" && stage.count > 0 && (
                    <span
                      aria-hidden
                      className="pulse-ring absolute inset-0 rounded-xl"
                      style={{ background: stage.color, opacity: 0.3 }}
                    />
                  )}
                  <div
                    className="relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors sm:h-11 sm:w-11"
                    style={{ background: stage.bg, color: stage.color }}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                </div>
                <p className="font-display text-base font-bold leading-none text-gh-ink sm:text-lg">
                  <CountUp value={stage.count} />
                </p>
                {/* 11px floor, not 10. This was text-[10px] with sm:text-[11px]
                    — i.e. the SMALLEST size on the smallest screen, which is
                    backwards. These four words are what make the diagram
                    readable at all, so they get more room on a phone, not
                    less. */}
                <p className="text-[11px] font-medium leading-none text-gh-ink-muted transition-colors group-hover:text-gh-ink-secondary">
                  {stage.label}
                </p>
              </Link>

              {i < stages.length - 1 && (
                <svg
                  aria-hidden
                  className="-mt-[26px] h-2 min-w-3 flex-1"
                  viewBox="0 0 100 8"
                  preserveAspectRatio="none"
                >
                  <line x1="0" y1="4" x2="100" y2="4" stroke="var(--gh-border)" strokeWidth="2" />
                  <line
                    className="flow-dash"
                    x1="0"
                    y1="4"
                    x2="100"
                    y2="4"
                    stroke={stages[i + 1].count > 0 ? stages[i + 1].color : "var(--gh-border-strong)"}
                    strokeOpacity="0.6"
                    strokeWidth="2"
                  />
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
