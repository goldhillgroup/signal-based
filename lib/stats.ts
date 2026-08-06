import { Company } from "./mock-companies";
import { Confidence } from "./supabase/types";

// A 'filter'/'hybrid' company accepted on ICP fit alone (no signal found) is
// still status: 'qualified' in the DB (see orchestrator.ts) — confidence:
// null is what actually distinguishes it. Counted separately here (fitOnly)
// rather than folded into `qualified`, which now only ever means "a real
// signal at high/medium confidence" — same distinction CompaniesTable and
// FolderCard already make.
export function getSummaryStats(companies: Company[]) {
  const total = companies.length;
  const qualified = companies.filter(
    (c) => c.status === "qualified" && (c.confidence === "high" || c.confidence === "medium")
  ).length;
  const verify = companies.filter(
    (c) => c.status === "qualified" && c.confidence === "verify"
  ).length;
  const fitOnly = companies.filter((c) => c.status === "qualified" && c.confidence === null).length;
  const accepted = qualified + verify + fitOnly;
  const rejected = companies.filter((c) => c.status === "rejected").length;
  const pending = companies.filter((c) => c.status === "pending").length;
  const contactsFound = companies.filter((c) => c.contact?.findStatus === "found").length;
  const contactsVerified = companies.filter(
    (c) => c.contact?.verificationStatus === "valid"
  ).length;

  return { total, qualified, verify, fitOnly, accepted, rejected, pending, contactsFound, contactsVerified };
}

export function getIndustryBreakdown(companies: Company[]) {
  const pool = companies.filter((c) => c.status === "qualified");
  const counts = { landscaping: 0, home_builder: 0 };
  pool.forEach((c) => {
    counts[c.industry] += 1;
  });
  const total = pool.length || 1;
  return [
    { key: "landscaping" as const, count: counts.landscaping, pct: Math.round((counts.landscaping / total) * 100) },
    { key: "home_builder" as const, count: counts.home_builder, pct: Math.round((counts.home_builder / total) * 100) },
  ];
}

export function getConfidenceBreakdown(companies: Company[]) {
  const pool = companies.filter((c) => c.status === "qualified" && c.confidence);
  const counts: Record<Confidence, number> = { high: 0, medium: 0, verify: 0 };
  pool.forEach((c) => {
    if (c.confidence) counts[c.confidence] += 1;
  });
  const total = pool.length || 1;
  return (["high", "medium", "verify"] as Confidence[]).map((key) => ({
    key,
    count: counts[key],
    pct: Math.round((counts[key] / total) * 100),
  }));
}

// Daily discovery volume (first_seen_at) for the trend chart. firstSeenAt may
// be a plain date (old mock data) or a full Supabase timestamptz (live data)
// — always bucket by the date portion.
export function getDailyTrend(companies: Company[]) {
  const byDay = new Map<string, number>();
  companies.forEach((c) => {
    const day = c.firstSeenAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  });

  const dates = Array.from(byDay.keys()).sort();
  if (dates.length === 0) return [];

  const start = new Date(dates[0]);
  const end = new Date(dates[dates.length - 1]);
  const days: { date: string; count: number }[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, count: byDay.get(iso) ?? 0 });
  }
  return days;
}

export function formatRelativeDate(iso: string, today: Date = new Date()) {
  // Accepts either a plain date ("2026-08-05") or a full Supabase timestamptz
  // ("2026-08-05T14:23:11.123456+00:00") — normalize both to a day boundary.
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((t.getTime() - dayStart.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  const weeks = Math.round(diffDays / 7);
  return `${weeks}w ago`;
}
