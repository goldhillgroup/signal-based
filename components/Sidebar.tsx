"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useSearches } from "@/lib/searches-store";
import { useMobileNav } from "@/lib/mobile-nav";
import { RadarIcon, FolderIcon, SettingsIcon, GridIcon, UsersIcon, XIcon } from "./icons";
import { SignOutButton } from "./SignOutButton";
import { SidebarStatus } from "./SidebarStatus";

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
// Ordered as the work actually flows: see where things stand -> find companies
// -> get their emails -> take the list -> keep the keys working.
//
// "Overview" leads because it is the only page that says what the numbers
// mean; landing on a search box tells you nothing about what you are looking
// at. "Enrichment" is its own destination rather than a button inside a folder
// because it is a genuinely separate job with its own cost model — it bills
// per PERSON, not per company, and it applies across searches, so burying it
// one folder deep both hid it and made it look like part of searching.
const NAV_ITEMS = [
  { label: "Overview", icon: GridIcon, href: "/dashboard/overview" },
  { label: "Signal Radar", icon: RadarIcon, href: "/dashboard" },
  { label: "Enrichment", icon: UsersIcon, href: "/dashboard/enrichment" },
  { label: "All Leads", icon: FolderIcon, href: "/dashboard/all-leads" },
  { label: "Settings", icon: SettingsIcon, href: "/dashboard/settings" },
];

// The rail's contents, shared verbatim by the always-on desktop aside and the
// slide-in mobile drawer so the two can never drift apart — same links, same
// live badges, same status block, same sign-out. `onNavigate` lets the drawer
// close itself the instant a link is tapped; the desktop rail passes nothing.
// `onClose` renders the drawer's own close button (the desktop rail never
// needs one, so it passes nothing there either).
function SidebarBody({
  userEmail,
  onNavigate,
  onClose,
}: {
  userEmail: string | null;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const { folders } = useSearches();

  // Live counts on the nav itself. A sidebar of five identical text rows makes
  // you open a page to find out whether anything is there; a number next to
  // "Enrichment" answers "is there work waiting" without the trip. Only shown
  // when non-zero — a row of zeroes is noise that trains you to ignore the
  // one time it says something.
  const readyToEnrich = folders.filter(
    (f) => f.status === "complete" && f.enrichmentStatus === "idle" &&
      f.qualifiedCount + f.verifyCount + f.fitOnlyCount > 0
  ).length;
  const badges: Record<string, number> = {
    "/dashboard/all-leads": folders.length,
    "/dashboard/enrichment": readyToEnrich,
  };

  return (
    <>
      {/* The brand block, given some weight. It was a logo and two lines of
          text on a flat field — correct and completely inert. A soft wash of
          brand colour bleeding from the top corner and a slow halo on the mark
          give the top of the rail somewhere for the eye to start, without
          adding anything that has to be read. */}
      <div className="relative flex h-16 shrink-0 items-center gap-2.5 overflow-hidden border-b border-white/10 px-5">
        <span
          aria-hidden
          className="pointer-events-none absolute -left-10 -top-16 h-32 w-32 rounded-full opacity-25 blur-2xl"
          style={{ background: "radial-gradient(circle, var(--gh-sky), transparent 70%)" }}
        />
        <span className="relative shrink-0">
          <Image src="/brand/goldhill-mark.png" alt="" width={28} height={28} />
          <span
            aria-hidden
            className="pulse-ring absolute -inset-1 rounded-full border border-gh-sky/50"
          />
        </span>
        <div className="relative leading-tight">
          <p className="font-display text-[13px] font-semibold tracking-wide">
            GOLDHILL GROUP
          </p>
          <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">
            Signal Radar
          </p>
        </div>

        {/* Only present in the mobile drawer. The overlay and the nav links
            already close it, but a labelled control the thumb can find beats
            making the user guess that tapping outside works. */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="relative ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <XIcon className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-5">
        {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
          // Exact match for the dashboard root so it doesn't also light up
          // while on /dashboard/lists/[id] — "All Leads" only lights up on
          // its own exact route.
          const active = pathname === href;
          const badge = badges[href] ?? 0;
          return (
            <Link
              key={label}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-[color,background-color] duration-200 ${
                active
                  ? "bg-white/10 text-white"
                  : "text-white/55 hover:bg-white/5 hover:text-white"
              }`}
            >
              {/* A rail on the active item rather than a dot at the far end.
                  The dot sat past the label where nothing else lives, so the
                  eye had to travel to find out where it was; a bar on the edge
                  reads at a glance and survives a long label. */}
              <span
                aria-hidden
                className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gh-sky transition-[opacity,transform] duration-[var(--gh-dur)] ease-[var(--gh-ease-out)] ${
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
                }`}
              />
              <Icon
                className={`h-4.5 w-4.5 shrink-0 transition-transform duration-200 ${
                  active ? "scale-110" : "group-hover:scale-110"
                }`}
              />
              <span className="flex-1">{label}</span>
              {badge > 0 && (
                <span
                  className={`tabular rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                    active ? "bg-white/20 text-white" : "bg-white/10 text-white/60"
                  }`}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Sits between the nav and the footer, so it fills the gap that opens up
          on a five-item menu rather than pushing anything off-screen. */}
      <SidebarStatus />

      <SignOutButton userEmail={userEmail} />
    </>
  );
}

export function Sidebar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();
  const { open, setOpen } = useMobileNav();

  // Navigating is the whole point of the drawer, so the moment the route
  // actually changes it has done its job and should get out of the way. The
  // per-link onClick also closes it, but this is the backstop that covers any
  // navigation the drawer didn't originate (e.g. a redirect) and guarantees it
  // never lingers over the page you just asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  // Escape closes it, the reflex every overlay owes a keyboard user.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <>
      {/* Desktop rail: the permanent column, unchanged. Only exists at lg+. */}
      <aside className="hidden h-full w-64 shrink-0 flex-col overflow-hidden bg-gh-sidebar text-white lg:flex">
        <SidebarBody userEmail={userEmail} />
      </aside>

      {/* Mobile scrim. Dims the page behind the drawer and is itself the
          tap-anywhere-to-close target. Kept in the tree and faded with opacity
          so both the fade-in and fade-out animate; pointer-events are dropped
          while closed so it never swallows taps meant for the page. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Mobile drawer. Same rail, slid in from the left over the content.
          h-dvh (not h-screen) so it fills the true viewport height on mobile
          instead of hiding its footer behind the browser chrome — the same
          reasoning the layout uses for its outer height. Translated fully
          off-screen when closed and made inert so its links can't be reached
          by tab or screen reader while hidden. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        aria-hidden={!open}
        inert={!open}
        className={`fixed left-0 top-0 z-50 flex h-dvh w-72 max-w-[85vw] flex-col overflow-hidden bg-gh-sidebar text-white shadow-2xl transition-transform duration-300 ease-out lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarBody
          userEmail={userEmail}
          onNavigate={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      </aside>
    </>
  );
}
