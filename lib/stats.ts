import { MOCK_COMPANIES, Company } from "./mock-companies";
import { Confidence } from "./supabase/types";

export function getSummaryStats(companies: Company[] = MOCK_COMPANIES) {
  const total = companies.length;
  const qualified = companies.filter(
    (c) => c.status === "qualified" && c.confidence !== "verify"
  ).length;
  const verify = companies.filter(
    (c) => c.status === "qualified" && c.confidence === "verify"
  ).length;
  const rejected = companies.filter((c) => c.status === "rejected").length;
  const pending = companies.filter((c) => c.status === "pending").length;
  const contactsFound = companies.filter((c) => c.contact?.findStatus === "found").length;
  const contactsVerified = companies.filter(
    (c) => c.contact?.verificationStatus === "valid"
  ).length;

  return { total, qualified, verify, rejected, pending, contactsFound, contactsVerified };
}

export function getIndustryBreakdown(companies: Company[] = MOCK_COMPANIES) {
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

export function getConfidenceBreakdown(companies: Company[] = MOCK_COMPANIES) {
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

// Daily discovery volume (first_seen_at) for the trend chart.
export function getDailyTrend(companies: Company[] = MOCK_COMPANIES) {
  const byDay = new Map<string, number>();
  companies.forEach((c) => {
    byDay.set(c.firstSeenAt, (byDay.get(c.firstSeenAt) ?? 0) + 1);
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

export function formatRelativeDate(iso: string, today = "2026-08-05") {
  const d = new Date(iso + "T00:00:00");
  const t = new Date(today + "T00:00:00");
  const diffDays = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  const weeks = Math.round(diffDays / 7);
  return `${weeks}w ago`;
}
