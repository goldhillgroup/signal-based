import { MOCK_COMPANIES, Company } from "./mock-companies";
import type { Industry } from "./supabase/types";

// Naive client-side stand-in for what OpenRouter + Apify will actually do:
// parse Jonathan's free-text ask into structured filters (state, industry),
// run it against the mock pool. Swap this function's body for a real
// Apify-discover -> OpenRouter-classify pipeline call later — the signature
// (query in, Company[] out) stays the same.
export function runSearch(query: string): Company[] {
  const q = query.toLowerCase();

  const STATE_TERMS: Record<string, string> = {
    texas: "TX",
    tx: "TX",
    "north carolina": "NC",
    nc: "NC",
    ohio: "OH",
    oh: "OH",
    georgia: "GA",
    ga: "GA",
  };
  const matchedStates = new Set<string>();
  Object.entries(STATE_TERMS).forEach(([term, code]) => {
    if (q.includes(term)) matchedStates.add(code);
  });

  const mentionsLandscaping = q.includes("landscap");
  const mentionsBuilder =
    q.includes("builder") || q.includes("construction") || q.includes("home build");

  let industry: Industry | null = null;
  if (mentionsLandscaping && !mentionsBuilder) industry = "landscaping";
  if (mentionsBuilder && !mentionsLandscaping) industry = "home_builder";

  let results = MOCK_COMPANIES;
  if (matchedStates.size > 0) results = results.filter((c) => matchedStates.has(c.state));
  if (industry) results = results.filter((c) => c.industry === industry);

  // Query was too generic to narrow anything down, or matched nothing —
  // fall back to the full pool rather than returning an empty folder.
  if (results.length === 0) results = MOCK_COMPANIES;
  return results;
}

// Rough scale for the "candidates scanned" number the progress screen shows
// before classification narrows it down to the real result set.
export function estimateScannedPool(resultCount: number) {
  return Math.max(resultCount * 3, 24);
}
