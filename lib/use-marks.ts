"use client";

import { useEffect, useState } from "react";
import type { Exportable } from "./csv-export";
import type { Company } from "./company";
import { useScoreRules } from "./use-score-rules";

/**
 * Notes and grades for every lead, so a client-side export carries them.
 *
 * Loaded once per page rather than per lead: the exports need all of them at
 * the moment a button is pressed, and 450 rows of short text is one small
 * request.
 */
export function useMarks() {
  const [marks, setMarks] = useState<Record<string, { note: string | null; grade: number | null }>>({});
  const rules = useScoreRules();

  useEffect(() => {
    let off = false;
    fetch("/api/marks")
      .then((r) => r.json())
      .then((j) => {
        if (!off && j?.marks) setMarks(j.marks);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  /** Attach what he has written to the rows about to be exported. */
  function withMarks(companies: Company[], listName?: (c: Company) => string): Exportable[] {
    return companies.map((c) => ({
      ...c,
      note: marks[c.id]?.note ?? null,
      ownGrade: marks[c.id]?.grade ?? null,
      rules,
      ...(listName ? { listName: listName(c) } : {}),
    })) as Exportable[];
  }

  return { marks, withMarks };
}
