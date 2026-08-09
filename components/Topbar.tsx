import Image from "next/image";
import Link from "next/link";
import { SearchIcon } from "./icons";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b border-gh-border bg-gh-surface/95 px-5 backdrop-blur supports-backdrop-blur:bg-gh-surface/80 lg:px-8">
      <Image
        src="/brand/goldhill-mark.png"
        alt=""
        width={24}
        height={24}
        className="shrink-0 rounded bg-gh-navy p-1 lg:hidden"
      />

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
            ReturnOverview, and a failed scheduled harvest is reported on
            Overview. Build a real one against those sources if it is wanted;
            do not put the shell back. */}
      </div>
    </header>
  );
}
