/**
 * What a folder's counters should say, worked out from its rows.
 *
 * A search keeps running totals (qualified, verify, fit-only, rejected) while it
 * works, and they are right for the search that wrote them. They go stale when
 * ANOTHER search changes a row in the folder: a lead retired because a newer
 * search found a real pair at the same company, or a duplicate removed by the
 * clean-up. Recounting from the rows is the repair, and the only safe one.
 */
export interface CountableRow {
  status: string;
  has_signal: boolean | null;
  confidence: string | null;
}

export interface SearchCounts {
  qualified_count: number;
  verify_count: number;
  fit_only_count: number;
  rejected_count: number;
}

export function searchCounts(rows: CountableRow[]): SearchCounts {
  const kept = rows.filter((r) => r.status === "qualified");
  const pairs = kept.filter((r) => r.has_signal);
  return {
    qualified_count: pairs.filter((r) => r.confidence !== "verify").length,
    verify_count: pairs.filter((r) => r.confidence === "verify").length,
    fit_only_count: kept.length - pairs.length,
    rejected_count: rows.filter((r) => r.status === "rejected").length,
  };
}
