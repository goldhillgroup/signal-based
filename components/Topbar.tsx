import Image from "next/image";
import Link from "next/link";
import { BellIcon, SearchIcon } from "./icons";

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

      <div className="ml-auto flex items-center gap-2.5">
        <span className="hidden items-center gap-1.5 rounded-full bg-gh-surface-sunken px-2.5 py-1 text-xs font-semibold text-gh-ink-muted sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-gh-gold" />
          Demo data — pipeline not yet wired up
        </span>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gh-navy px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gh-navy-2"
        >
          <SearchIcon className="h-4 w-4" />
          New search
        </Link>
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-gh-ink-secondary transition-colors hover:bg-gh-surface-sunken"
          aria-label="Notifications"
        >
          <BellIcon className="h-4.5 w-4.5" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gh-orange" />
        </button>
      </div>
    </header>
  );
}
