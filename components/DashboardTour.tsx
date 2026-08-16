"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { RadarIcon, UsersIcon, FolderIcon, GridIcon, SettingsIcon, HelpIcon } from "./icons";

/**
 * A first-run tour of the five screens.
 *
 * WHY A TOUR AND NOT MORE ON-SCREEN COPY. The product is handed to somebody who
 * has never seen it and will open it alone, and the thing he needs first is not
 * what any single control does — it is what the five destinations are FOR, and
 * which one to start on. That is a shape you can explain in ninety seconds once,
 * and cannot explain by adding another sentence to every page.
 *
 * SHOWN ONCE, AND ONLY ONCE. It writes a flag to localStorage on the way out
 * whether it was completed or skipped, because a tour that reappears is an
 * obstacle rather than a welcome. "Take the tour again" lives in Settings for
 * anyone who wants it back.
 *
 * localStorage, not the database: this is a property of a person on a browser,
 * not of the account. A second person opening the shared login deserves the
 * tour too, and nobody should have to think about that.
 */
const SEEN_KEY = "gh-tour-seen-v1";

/**
 * localStorage read as an external store.
 *
 * The obvious version — read the flag in an effect and setState — is a
 * synchronous setState inside an effect, which lint rejects and which is
 * genuinely worse: it renders once with the wrong answer and then corrects
 * itself, so somebody who dismissed the tour months ago sees a flash of it on
 * every page load.
 *
 * useSyncExternalStore has a server snapshot, so the server and the first
 * client render agree on "seen" (render nothing) and the real value arrives
 * without a flash or a hydration mismatch.
 */
const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function hasSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Private browsing, or storage disabled. Failing CLOSED is right: a tour
    // that cannot remember being dismissed would return on every page load.
    return true;
  }
}
/** On the server nobody has storage, so assume seen and render nothing. */
function seenOnServer() {
  return true;
}
function markSeen(seen: boolean) {
  try {
    if (seen) window.localStorage.setItem(SEEN_KEY, "1");
    else window.localStorage.removeItem(SEEN_KEY);
  } catch {
    /* the tour simply does not persist */
  }
  listeners.forEach((fn) => fn());
}

interface Stop {
  icon: (p: { className?: string }) => React.ReactNode;
  /** The nav item this stop is about, matched on data-tour. */
  target: string;
  screen: string;
  headline: string;
  body: string;
}

const STOPS: Stop[] = [
  // IN RAIL ORDER, top to bottom. It used to open on Signal Radar because
  // that is where the work starts, then jump up to Overview and back down,
  // which is disorienting when the spotlight is walking a vertical list:
  // the highlight moved up, down, up, down for no reason the reader could
  // see. Following the rail means the light travels one way.
  {
    icon: GridIcon,
    target: "/dashboard/overview",
    screen: "Overview",
    headline: "What you have so far",
    body:
      "Your totals, how many companies were read to find them, and anything that finished while you were away. If a search is still running, it is here.",
  },
  {
    icon: RadarIcon,
    target: "/dashboard",
    screen: "Signal Radar",
    headline: "Where you start",
    body:
      "Pick a trade and some states, press Search, and it reads company websites looking for a founder still running things with a son or daughter stepping up beside them. The form is already set to your profile, so most of the time you can just press Search.",
  },
  {
    icon: UsersIcon,
    target: "/dashboard/enrichment",
    screen: "Enrichment",
    headline: "Getting an email address",
    body:
      "Separate from searching, and never automatic. Tick who you want — the pairs, the good fits, or the cut ones too — and it looks up an address for the successor first. You are only charged when one is actually found.",
  },
  {
    icon: FolderIcon,
    target: "/dashboard/all-leads",
    screen: "Lead Lists",
    headline: "Every search you have run",
    body:
      "One list per search, and every lead from all of them in one place. Open a list to read its leads, check a quote, or export it. Inside, they are split three ways: a confirmed founder-and-successor pair, a good family-owned fit with no successor named yet, and the ones that were cut, shown with the reason so you can disagree.",
  },
  {
    icon: SettingsIcon,
    target: "/dashboard/settings",
    screen: "Settings",
    headline: "The keys, and what is left",
    body:
      "Each service shows its balance live. If one ever runs out, paste a new key here and it works immediately. Nothing else needs to be configured, and nothing runs on its own.",
  },
];

export function DashboardTour() {
  const seen = useSyncExternalStore(subscribe, hasSeen, seenOnServer);
  const [i, setI] = useState(0);
  const open = !seen;
  const close = useCallback(() => {
    markSeen(true);
    // Next time it is opened it starts at the beginning, not wherever it was
    // abandoned three weeks ago.
    setI(0);
  }, []);

  // WHERE THE THING BEING DESCRIBED ACTUALLY IS.
  //
  // A centred box that names a screen is not a tour, it is a list of screens
  // read aloud. Measuring the real nav item lets the spotlight sit on it and
  // the card sit beside it, so "this one" has a referent.
  //
  // Re-measured on resize and scroll because a rect taken once is wrong the
  // moment anything moves, and null on a narrow viewport where the sidebar is
  // a closed drawer, which the render below falls back for rather than
  // pointing at nothing.
  const [rect, setRect] = useState<DOMRect | null>(null);
  const target = STOPS[i]?.target;

  useEffect(() => {
    if (!open || !target) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      const r = el?.getBoundingClientRect();
      // A drawer that is closed still has a rect, just a useless one.
      setRect(r && r.width > 0 && r.height > 0 ? r : null);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, target]);

  // Escape closes it. A modal you cannot dismiss from the keyboard is a trap,
  // and this one is the very first thing a new person meets.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && i < STOPS.length - 1) setI(i + 1);
      if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, i, close]);

  if (!open) return null;

  const stop = STOPS[i];
  const Icon = stop.icon;
  const last = i === STOPS.length - 1;

  // The card sits beside the highlighted item when there is one, and in the
  // middle of the screen when there is not.
  const PAD = 8;
  const CARD_W = 380;
  const anchored = rect
    ? {
        // Clamped so a card next to the last nav item cannot run off the
        // bottom of the viewport.
        top: Math.min(Math.max(rect.top - 12, 16), window.innerHeight - 300),
        left: Math.min(rect.right + 20, window.innerWidth - CARD_W - 16),
      }
    : null;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* THE SPOTLIGHT. A ring around the real element, with the dimming done
          by an enormous outward shadow rather than a full-screen overlay, so
          the item stays at its own natural brightness and everything else
          darkens around it. No cloning, no z-index fight with the sidebar. */}
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-lg ring-2 ring-gh-sky transition-all duration-300 ease-out"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(11, 18, 32, 0.55)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-gh-ink/55 backdrop-blur-sm" />
      )}

      {/* Clicking the dimmed area is a reasonable way to leave. */}
      <button
        type="button"
        aria-label="Close the tour"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-headline"
        className={`absolute rounded-2xl border border-gh-border bg-gh-surface p-6 shadow-xl transition-all duration-300 ease-out ${
          anchored ? "" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        }`}
        style={anchored ? { top: anchored.top, left: anchored.left, width: CARD_W } : { width: CARD_W, maxWidth: "calc(100vw - 2rem)" }}
      >
        <div className="flex items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gh-navy text-white">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gh-sky">
              {stop.screen}
            </p>
            <h2
              id="tour-headline"
              className="mt-0.5 font-display text-lg font-semibold leading-snug text-gh-ink"
            >
              {stop.headline}
            </h2>
          </div>
        </div>

        <p className="mt-3.5 text-sm leading-relaxed text-gh-ink-secondary">{stop.body}</p>

        <div className="mt-6 flex items-center justify-between gap-3">
          {/* Progress as dots, not "3 of 5" — the count is short enough to see. */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {STOPS.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  n === i ? "w-5 bg-gh-navy" : "w-1.5 bg-gh-border-strong"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {i > 0 && (
              <button
                type="button"
                onClick={() => setI(i - 1)}
                className="min-h-11 cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-gh-ink-muted transition-colors duration-200 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
              >
                Back
              </button>
            )}
            {/* Skip stays available on every stop. Somebody who already knows
                the product should not have to click through five screens. */}
            {!last && (
              <button
                type="button"
                onClick={close}
                className="min-h-11 cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-gh-ink-muted transition-colors duration-200 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
              >
                Skip
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? close() : setI(i + 1))}
              className="min-h-11 cursor-pointer rounded-lg bg-gh-navy px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
            >
              {last ? "Start searching" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Starts the tour, from the top bar, on every page.
 *
 * The tour shows itself once and remembers, which is right — a welcome that
 * reappears is an obstacle. But it left no way back except a button on the
 * Settings page, which is the last place somebody looks when they cannot
 * remember what a screen does. A help affordance nobody can find is the same
 * as no help.
 *
 * Deliberately quiet: an outline button beside the one primary action, not
 * competing with it.
 */
export function TourButton() {
  return (
    <button
      type="button"
      onClick={() => markSeen(false)}
      title="A short walk through the five screens"
      // Styled for the dark rail it now sits in, and shaped like the nav rows
      // above it so it reads as part of the same list rather than a control
      // dropped underneath them.
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/45 transition-[color,background-color] duration-200 hover:bg-white/5 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/50"
    >
      <HelpIcon className="h-[18px] w-[18px] shrink-0" />
      Take the tour
    </button>
  );
}

/** Puts the tour back, from Settings. */
export function ReplayTourButton() {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        markSeen(false);
        setDone(true);
        window.location.href = "/dashboard/overview";
      }}
      className="min-h-11 cursor-pointer rounded-lg border border-gh-border bg-gh-surface px-3.5 py-2 text-xs font-semibold text-gh-ink-secondary transition-colors duration-200 hover:border-gh-sky/40 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
    >
      {done ? "Opening…" : "Take the tour again"}
    </button>
  );
}
