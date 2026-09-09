"use client";

import { useEffect, useState } from "react";
import { DEFAULT_RULES, type ScoreRules } from "./lead-score";

/**
 * The scoring rules, for anything that shows or exports a score.
 *
 * Without this the Settings card was decoration: it wrote five numbers to the
 * database and every score on screen went on using the defaults. A setting
 * that changes nothing is worse than no setting, because it looks like it
 * worked.
 */
export function useScoreRules(): ScoreRules {
  const [rules, setRules] = useState<ScoreRules>(DEFAULT_RULES);
  useEffect(() => {
    let off = false;
    fetch("/api/score-rules")
      .then((r) => r.json())
      .then((j) => {
        if (!off && j?.rules) setRules(j.rules);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);
  return rules;
}
