"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RadarIcon, FolderIcon } from "./icons";
import { SignOutButton } from "./SignOutButton";

// Two real destinations — "Crawl Runs" and "Reports" were placeholders from
// an earlier design (a standing continuous-crawl model) that never got
// built; removed rather than left as dead buttons that do nothing when
// clicked. Add back once there's something real behind them.
//
// Same reasoning removed the "Coaching Programs" list that used to sit below
// this nav (2026-08-06) — three more dead buttons, this time referencing
// Jonathan's actual coaching offerings (Next Gen Navigator™, Family
// Retreats, Individual Coaching), not anything Signal Radar itself does.
// Not "coming soon" for this tool, just unrelated decoration.
//
// "All Leads" added the same day — every accepted company across every
// search, combined into one place to browse/download, instead of needing to
// open each search folder individually to find a spreadsheet.
const NAV_ITEMS = [
  { label: "Signal Radar", icon: RadarIcon, href: "/dashboard" },
  { label: "All Leads", icon: FolderIcon, href: "/dashboard/all-leads" },
];

export function Sidebar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-gh-navy text-white lg:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-5">
        <Image
          src="/brand/goldhill-mark.png"
          alt=""
          width={28}
          height={28}
          className="shrink-0"
        />
        <div className="leading-tight">
          <p className="font-display text-[13px] font-semibold tracking-wide">
            GOLDHILL GROUP
          </p>
          <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">
            Signal Radar
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-5">
        {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
          // Exact match for the dashboard root so it doesn't also light up
          // while on /dashboard/lists/[id] — "All Leads" only lights up on
          // its own exact route.
          const active = pathname === href;
          const className = `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            active
              ? "bg-white/10 text-white"
              : "text-white/60 hover:bg-white/5 hover:text-white/90"
          }`;
          return (
            <Link key={label} href={href} className={className}>
              <Icon className="h-4.5 w-4.5" />
              {label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gh-sky" />}
            </Link>
          );
        })}
      </nav>

      <SignOutButton userEmail={userEmail} />
    </aside>
  );
}
