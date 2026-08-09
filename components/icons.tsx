// Minimal inline stroke-icon set — keeps the dashboard dependency-free.
// 20x20 viewbox, 1.6px stroke, rounded joins, currentColor.

type IconProps = { className?: string };
const base = "1.6";

export function FolderIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path
        d="M2.5 5.5a1 1 0 011-1H8l1.5 2H16.5a1 1 0 011 1v7.5a1 1 0 01-1 1h-13a1 1 0 01-1-1v-9.5z"
        stroke="currentColor"
        strokeWidth={base}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Carries the "selected" meaning on the state toggles alongside the fill —
// WCAG: never let colour alone be the signal.
export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M5.5 8l4.5 4.5L14.5 8" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M12.5 4.5L6 10l6.5 5.5M6.5 10h11" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path
        d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 14.5v1a1 1 0 001 1h10a1 1 0 001-1v-1"
        stroke="currentColor"
        strokeWidth={base}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth={base} />
      <path d="M17 17l-3.5-3.5" stroke="currentColor" strokeWidth={base} strokeLinecap="round" />
    </svg>
  );
}

export function RadarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth={base} />
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth={base} opacity="0.6" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" />
      <path d="M10 10L15 5.5" stroke="currentColor" strokeWidth={base} strokeLinecap="round" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <circle cx="7.5" cy="7" r="2.5" stroke="currentColor" strokeWidth={base} />
      <path d="M2.5 16c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth={base} strokeLinecap="round" />
      <path d="M13 5.2a2.5 2.5 0 010 4.9M15.8 16c0-2.3-1.5-4.2-3.6-4.8" stroke="currentColor" strokeWidth={base} strokeLinecap="round" />
    </svg>
  );
}


export function ZapIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M11 2.5L4.5 11.5H9.5L8.5 17.5L15.5 8H10.5L11 2.5Z" stroke="currentColor" strokeWidth={base} strokeLinejoin="round" />
    </svg>
  );
}


export function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth={base} strokeLinecap="round" />
    </svg>
  );
}


export function BuildingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <rect x="4" y="3" width="9" height="14" rx="1" stroke="currentColor" strokeWidth={base} />
      <path d="M13 8.5h3v8.5h-3M6.7 6.5h1.2M6.7 9.5h1.2M6.7 12.5h1.2M9.7 6.5h1.2M9.7 9.5h1.2M9.7 12.5h1.2" stroke="currentColor" strokeWidth={base} strokeLinecap="round" />
    </svg>
  );
}


export function DotIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 8 8" fill="currentColor" className={className} aria-hidden>
      <circle cx="4" cy="4" r="4" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth={base} />
      <path
        d="M10 3v1.6M10 15.4V17M17 10h-1.6M4.6 10H3M14.9 5.1l-1.1 1.1M6.2 13.7l-1.1 1.1M14.9 14.9l-1.1-1.1M6.2 6.2L5.1 5.1"
        stroke="currentColor"
        strokeWidth={base}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InboxIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M3 11l2-6.5A1 1 0 016 4h8a1 1 0 011 .5L17 11" stroke="currentColor" strokeWidth={base} strokeLinejoin="round" />
      <path d="M3 11h4.2a2 2 0 013.6 0H17v3.5A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5V11z" stroke="currentColor" strokeWidth={base} strokeLinejoin="round" />
    </svg>
  );
}

