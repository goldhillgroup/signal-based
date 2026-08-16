"use client";

import Link from "next/link";
import { useMobileNav } from "@/lib/mobile-nav";
import { SearchIcon, MenuIcon } from "./icons";

export function Topbar() {
  const { toggle } = useMobileNav();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b border-gh-border bg-gh-surface/95 px-5 backdrop-blur supports-backdrop-blur:bg-gh-surface/80 lg:px-8">
      {/* The top-left, below lg where the nav rail is hidden. This used to be a
          bare logo image with no click handler — tapping it, the natural
          instinct for "open the menu", did nothing, which left the entire
          navigation (Overview, Enrichment, All Leads, Settings) unreachable on
          every phone and tablet. It is now a real button that opens the nav
          drawer. Hidden at lg+, where the permanent rail makes it redundant. */}
      <button
        type="button"
        onClick={toggle}
        aria-label="Open menu"
        className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gh-ink transition-colors hover:bg-gh-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-navy lg:hidden"
      >
        <MenuIcon className="h-6 w-6" />
      </button>

      {/* A "Demo data, pipeline not yet wired up" badge lived here from the
          mock phase. It was still rendering over real, live, paid-for results,
          which is the worst possible direction for a labeling error: it tells
          the user his genuine leads are fake. Removed when the pipeline went
          live rather than left to rot. */}
      <div className="ml-auto flex items-center gap-2.5">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gh-navy px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2"
        >
          <SearchIcon className="h-4 w-4" />
          New search
        </Link>
        {/* The notification bell lived here and did NOTHING: no click handler,
            no menu, and a hardcoded orange dot that was permanently lit and
            could never clear. A fake unread badge is worse than no bell,
            because it teaches you to ignore an indicator that never meant
            anything, and the one time something DOES need attention you will
            not look.
            Everything it pretended to announce already has a real home:
            finished searches and "ready to enrich" appear on the dashboard via
            ReturnOverview, and anything that went wrong is reported on
            Overview. Build a real one against those sources if it is wanted;
            do not put the shell back. */}
      </div>
    </header>
  );
}
