import type { Industry } from "../supabase/types";

export interface ParsedIntent {
  states: string[]; // 2-letter codes; empty = no state filter
  industry: Industry | null; // null = both industries
}

const STATE_TERMS: Record<string, string> = {
  texas: "TX",
  tx: "TX",
  "north carolina": "NC",
  nc: "NC",
  ohio: "OH",
  oh: "OH",
  georgia: "GA",
  ga: "GA",
  california: "CA",
  ca: "CA",
  florida: "FL",
  fl: "FL",
  tennessee: "TN",
  tn: "TN",
  colorado: "CO",
  co: "CO",
  arizona: "AZ",
  az: "AZ",
};

// Naive intent parse — good enough to hand structured params to Apify's search
// query builder. Swap for an OpenRouter call here too if free-text gets richer
// than "industry + state" (e.g. revenue band, specific succession language).
export function parseIntent(query: string): ParsedIntent {
  const q = query.toLowerCase();

  const states = new Set<string>();
  Object.entries(STATE_TERMS).forEach(([term, code]) => {
    if (new RegExp(`\\b${term}\\b`).test(q)) states.add(code);
  });

  const mentionsLandscaping = q.includes("landscap");
  const mentionsBuilder =
    q.includes("builder") || q.includes("construction") || q.includes("home build");

  let industry: Industry | null = null;
  if (mentionsLandscaping && !mentionsBuilder) industry = "landscaping";
  if (mentionsBuilder && !mentionsLandscaping) industry = "home_builder";

  return { states: Array.from(states), industry };
}

export function industryLabel(industry: Industry | null): string {
  if (industry === "landscaping") return "landscaping";
  if (industry === "home_builder") return "home building";
  return "landscaping or home building";
}
