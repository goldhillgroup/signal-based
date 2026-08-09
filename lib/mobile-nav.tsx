"use client";

// Shared open/closed state for the mobile navigation drawer.
//
// The nav rail (components/Sidebar.tsx) is `hidden lg:flex` — it does not
// exist below the lg breakpoint, which covers every phone and most tablets.
// That left the whole app with no way to reach Overview, Enrichment, All
// Leads or Settings on a touch device: the top-left of the header was a bare
// logo image with no click handler, so tapping it did nothing.
//
// The button that opens the drawer lives in the Topbar and the drawer itself
// lives in the Sidebar — two sibling components rendered by the dashboard
// layout. This tiny context is the one thing they both need to share, so it
// sits here rather than being lifted into either component.

import { createContext, useCallback, useContext, useState, ReactNode } from "react";

interface MobileNavContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <MobileNavContext.Provider value={{ open, setOpen, toggle }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  const ctx = useContext(MobileNavContext);
  if (!ctx) {
    throw new Error("useMobileNav must be used within a MobileNavProvider");
  }
  return ctx;
}
