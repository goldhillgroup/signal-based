import Image from "next/image";
import Link from "next/link";
import { RadarIcon, InboxIcon, ChartIcon } from "./icons";
import { SignOutButton } from "./SignOutButton";

const NAV_ITEMS = [
  { label: "Signal Radar", icon: RadarIcon, href: "/dashboard", active: true },
  { label: "Crawl Runs", icon: InboxIcon, href: null, active: false },
  { label: "Reports", icon: ChartIcon, href: null, active: false },
];

export function Sidebar({ userEmail }: { userEmail: string | null }) {
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
        {NAV_ITEMS.map(({ label, icon: Icon, href, active }) => {
          const className = `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            active
              ? "bg-white/10 text-white"
              : "text-white/60 hover:bg-white/5 hover:text-white/90"
          }`;
          const content = (
            <>
              <Icon className="h-4.5 w-4.5" />
              {label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gh-sky" />}
            </>
          );
          return href ? (
            <Link key={label} href={href} className={className}>
              {content}
            </Link>
          ) : (
            <button key={label} type="button" className={className}>
              {content}
            </button>
          );
        })}

        <div className="pt-4">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-white/35">
            Coaching Programs
          </p>
          {["Next Gen Navigator™", "Family Retreats", "Individual Coaching"].map(
            (item) => (
              <button
                key={item}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-white/50 transition-colors hover:bg-white/5 hover:text-white/85"
              >
                <span className="h-1 w-1 rounded-full bg-white/30" />
                {item}
              </button>
            )
          )}
        </div>
      </nav>

      <SignOutButton userEmail={userEmail} />
    </aside>
  );
}
