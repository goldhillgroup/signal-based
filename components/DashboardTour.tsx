"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { RadarIcon, UsersIcon, FolderIcon, GridIcon, SettingsIcon } from "./icons";

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
  screen: string;
  headline: string;
  body: string;
}

const STOPS: Stop[] = [
  {
    icon: RadarIcon,
    screen: "Signal Radar",
    headline: "Where you start",
    body:
      "Pick a trade and some states, press Search, and it reads company websites looking for a founder still running things with a son or daughter stepping up beside them. The form is already set to your profile, so most of the time you can just press Search.",
  },
  {
    icon: GridIcon,
    screen: "Overview",
    headline: "What you have so far",
    body:
      "Your totals, how many companies were read to find them, and anything that finished while you were away. If a search is still running, it is here.",
  },
  {
    icon: FolderIcon,
    screen: "All Leads",
    headline: "Everything ever found",
    body:
      "Every lead from every search, in one list. Each search also gets its own folder. Inside a folder, leads are split three ways: a confirmed founder-and-successor pair, a good family-owned fit with no successor named yet, and the ones that were cut — shown with the reason, so you can disagree.",
  },
  {
    icon: UsersIcon,
    screen: "Enrichment",
    headline: "Getting an email address",
    body:
      "Separate from searching, and never automatic. Tick who you want — the pairs, the good fits, or the cut ones too — and it looks up an address for the successor first. You are only charged when one is actually found.",
  },
  {
    icon: SettingsIcon,
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

  const close = useCallback(() => markSeen(true), []);

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

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-gh-ink/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-headline"
    >
      <div className="w-full max-w-lg rounded-2xl border border-gh-border bg-gh-surface p-6 shadow-xl">
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
