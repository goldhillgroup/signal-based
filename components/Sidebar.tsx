"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useCallback, useSyncExternalStore } from "react";
import { useSearches } from "@/lib/searches-store";
import { useMobileNav } from "@/lib/mobile-nav";
import { RadarIcon, FolderIcon, SettingsIcon, GridIcon, UsersIcon, XIcon, ArrowLeftIcon } from "./icons";
import { SignOutButton } from "./SignOutButton";
import { TourButton } from "./DashboardTour";
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
  { label: "Lead Lists", icon: FolderIcon, href: "/dashboard/all-leads" },
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
  collapsed = false,
}: {
  userEmail: string | null;
  onNavigate?: () => void;
  onClose?: () => void;
  /** Icons only. Desktop rail only; the mobile drawer is never collapsed. */
  collapsed?: boolean;
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
  // EACH BADGE COUNTS THE THING ITS LABEL NAMES.
  //
  // The row said "All Leads" and carried a count of FOLDERS, so a dashboard
  // holding 28 leads across 3 searches showed a 3 beside the word "Leads".
  // Making it count leads fixed the arithmetic and lost the more useful fact:
  // how many lists there are to open. So the LABEL moved instead. "Lead Lists"
  // and "Enrichment" now both count lists, which is the same noun, and the
  // numbers finally sit beside each other meaning the same kind of thing.
  // Lists WITH SOMETHING IN THEM, which is what the page itself shows. The
  // badge counted every folder, including searches that finished having found
  // nothing, so the rail said 3 and the page it opened said "1 list". A number
  // that disagrees with the screen behind it is worse than no number.
  const listsWithLeads = folders.filter(
    (f) => f.qualifiedCount + f.verifyCount + f.fitOnlyCount > 0
  ).length;
  const badges: Record<string, number> = {
    "/dashboard/all-leads": listsWithLeads,
    "/dashboard/enrichment": readyToEnrich,
  };

  return (
    <>
      {/* The brand block, given some weight. It was a logo and two lines of
          text on a flat field — correct and completely inert. A soft wash of
          brand colour bleeding from the top corner and a slow halo on the mark
          give the top of the rail somewhere for the eye to start, without
          adding anything that has to be read. */}
      <div
        className={`relative flex h-16 shrink-0 items-center gap-2.5 overflow-hidden border-b border-white/10 ${
          collapsed ? "justify-center px-0" : "px-5"
        }`}
      >
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
        {!collapsed && (
          <div className="relative leading-tight">
            <p className="font-display text-[13px] font-semibold tracking-wide">
              GOLDHILL GROUP
            </p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">
              Signal Radar
            </p>
          </div>
        )}

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

      <nav className={`min-h-0 flex-1 space-y-1 overflow-y-auto py-5 ${collapsed ? "px-2" : "px-3"}`}>
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
              // The first-run tour points at these by href, so it highlights
              // the real navigation rather than describing it from a box in
              // the middle of the screen. See DashboardTour.
              data-tour={href}
              // The label is gone when collapsed, so the icon has to carry
              // the name some other way or the rail becomes five glyphs.
              title={collapsed ? label : undefined}
              className={`group relative flex w-full items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-[color,background-color] duration-200 ${
                collapsed ? "justify-center px-0" : "px-3"
              } ${
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
              {!collapsed && <span className="flex-1">{label}</span>}
              {badge > 0 &&
                (collapsed ? (
                  /* No room for "12" at 64px wide, and a clipped number is
                     worse than none. A dot keeps the one bit that matters at
                     a glance, that there is something in there, and the count
                     comes back the moment the rail is expanded. */
                  <span
                    aria-label={`${badge}`}
                    className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gh-sky"
                  />
                ) : (
                  <span
                    className={`tabular rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                      active ? "bg-white/20 text-white" : "bg-white/10 text-white/60"
                    }`}
                  >
                    {badge}
                  </span>
                ))}
            </Link>
          );
        })}
      </nav>

      {/* The tour lives with the navigation it points AT, not in the top bar.
          Every stop highlights one of the five rows above it, so the way in
          belongs beside them. */}
      {!collapsed && (
        <div className="px-3 pb-1">
          <TourButton />
        </div>
      )}

      {/* Sits between the nav and the footer, so it fills the gap that opens up
          on a five-item menu rather than pushing anything off-screen. */}
      {!collapsed && <SidebarStatus />}

      <SignOutButton userEmail={userEmail} collapsed={collapsed} />
    </>
  );
}


/**
 * Collapse the desktop rail to icons.
 *
 * useSyncExternalStore, matching ThemeToggle, because the width has to be
 * right on the FIRST paint. Read in an effect instead and every navigation
 * starts with a 256px rail that snaps to 64px a frame later, which is worse
 * than not having the feature.
 *
 * getServerSnapshot returns false: the server cannot read localStorage, and
 * expanded is what the markup must say for hydration to match.
 */
const COLLAPSE_KEY = "gh-rail-collapsed";
const railListeners = new Set<() => void>();

function subscribeRail(cb: () => void) {
  railListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    railListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    // Private modes throw. A rail width is never worth an error.
    return false;
  }
}

function useRailCollapsed(): [boolean, (v: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribeRail, readCollapsed, () => false);
  const set = useCallback((v: boolean) => {
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
    } catch {
      // Still apply it for this session even if it cannot be remembered.
    }
    // storage events do not fire in the tab that made the change.
    railListeners.forEach((l) => l());
  }, []);
  return [collapsed, set];
}

export function Sidebar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useRailCollapsed();
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
      <aside
        className={`relative hidden h-full shrink-0 flex-col overflow-hidden bg-gh-sidebar text-white transition-[width] duration-200 ease-out lg:flex ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <SidebarBody userEmail={userEmail} collapsed={collapsed} />
        {/* Pinned to the rail's own bottom edge rather than sitting in the
            scrolling nav, so it stays reachable however long the nav gets. */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 border-t border-white/10 text-xs font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30"
        >
          <ArrowLeftIcon
            className={`h-4 w-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
          />
          {!collapsed && <span>Collapse</span>}
        </button>
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
        className={`slide-panel fixed left-0 top-0 z-50 flex h-dvh w-72 max-w-[85vw] flex-col overflow-hidden bg-gh-sidebar text-white shadow-2xl transition-transform duration-300 ease-out lg:hidden ${
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
