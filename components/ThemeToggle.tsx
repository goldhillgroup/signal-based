"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MoonIcon, SunIcon, MonitorIcon } from "./icons";

type Theme = "system" | "light" | "dark";
const KEY = "gh-theme";

/**
 * Light / dark / follow-the-system.
 *
 * Three states rather than a two-way switch, because a plain toggle has to
 * pick a starting side and thereby overrides the operating system for someone
 * who never asked it to. "System" is the default and stays the default until
 * he actively chooses otherwise.
 *
 * The choice is written to <html data-theme> and to localStorage; the CSS in
 * globals.css does the rest, so no component needs to know the theme exists.
 * The blocking script in layout.tsx applies the stored value before first
 * paint, which is what stops a dark-mode user being flashed a white page on
 * every navigation.
 */
/**
 * localStorage as an external store.
 *
 * useSyncExternalStore rather than useState + useEffect, because the theme
 * genuinely lives outside React: the inline script in app/layout.tsx has
 * already read it and applied data-theme before this component exists. Syncing
 * it into state in an effect means an extra render on every mount and trips
 * React's cascading-render rule; this reads it directly and gives cross-tab
 * updates for free, so changing the theme in one tab moves the toggle in the
 * other.
 *
 * getServerSnapshot returns "system" because the server has no localStorage to
 * read, which is also what the markup must say for hydration to match.
 */
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    // Private modes throw on localStorage. A theme is never worth an error.
    return "system";
  }
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  const choose = useCallback((next: Theme) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Still apply it for this session even if it cannot be remembered.
    }
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    // storage events do not fire in the tab that made the change.
    listeners.forEach((l) => l());
  }, []);

  const OPTIONS: { key: Theme; label: string; Icon: typeof SunIcon }[] = [
    { key: "light", label: "Light", Icon: SunIcon },
    { key: "dark", label: "Dark", Icon: MoonIcon },
    { key: "system", label: "System", Icon: MonitorIcon },
  ];

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5"
    >
      {OPTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => choose(key)}
          aria-pressed={theme === key}
          title={label}
          className={`flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
            theme === key ? "bg-white/15 text-white" : "text-white/45 hover:text-white/80"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
