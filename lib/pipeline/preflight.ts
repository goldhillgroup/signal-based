import { resolveSetting, getSettingFresh, setSetting } from "../settings";

/**
 * Can a run actually succeed right now — and if not, say so where a human
 * will see it.
 *
 * WHY THIS EXISTS: once the weekly harvest is on a cron there is nobody
 * watching it. The failure that matters is not a crash; a crash is loud. It is
 * the QUIET one: OpenRouter runs out of credit, every classify call 402s, the
 * harvest finishes with zero results, and Monday's folder is empty. That is
 * indistinguishable from "there were no leads this week" — which is a lie the
 * system tells confidently, and the most expensive kind of bug in a product
 * whose whole value is that its output can be trusted.
 *
 * So: check the one vendor that cannot be worked around BEFORE spending
 * anything, and when it is dead, record a visible reason instead of producing
 * an empty folder. "I did not run, because X" is always better than "here are
 * no results".
 *
 * Only OpenRouter is a hard gate. Every other capability has a fallback —
 * page fetch has three providers, search has four channels, and the pipeline
 * degrades to whatever still answers. Classification has exactly one provider,
 * so it is the single point where "no credit" means "no product".
 */

export const HEALTH_KEY = "LAST_HARVEST_HEALTH";

export interface HarvestHealth {
  /** ISO instant of the last cron decision. */
  at: string;
  ok: boolean;
  /** Human sentence — shown verbatim in the dashboard. */
  reason: string;
  /** What ran, when it did. */
  started?: string[];
}

interface Credits {
  data?: { total_credits?: number; total_usage?: number };
}

/**
 * What one run costs OpenRouter, measured across all 7 metered searches:
 * mean $0.212, worst $0.290, on targets of 3-10. Cost scales with how many
 * companies get classified, which scales with the target.
 *
 * The floor is deliberately TWICE the projection. Having exactly enough to
 * finish is not enough — a run that drains the balance to zero leaves the
 * NEXT one to die halfway through, which is the failure this is meant to
 * prevent. Better to refuse early with a clear message than to produce a
 * folder that is half a search.
 */
const OPENROUTER_PER_10_TARGET = 0.29; // worst observed, not the mean
const FLOOR_MULTIPLIER = 2;

export function requiredCreditFor(targetSignals: number): number {
  const projected = (Math.max(targetSignals, 1) / 10) * OPENROUTER_PER_10_TARGET;
  return Math.round(projected * FLOOR_MULTIPLIER * 100) / 100;
}

/** Best readable remaining balance across the configured keys, or null. */
export async function openRouterRemaining(): Promise<number | null> {
  const [primary, fallback] = await Promise.all([
    resolveSetting("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY),
    resolveSetting("OPENROUTER_API_KEY_2", process.env.OPENROUTER_API_KEY_2),
  ]);
  let best: number | null = null;
  for (const key of [primary, fallback].filter(Boolean) as string[]) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const b = (await res.json()) as Credits;
      const total = b.data?.total_credits;
      const used = b.data?.total_usage;
      if (typeof total !== "number" || typeof used !== "number") continue;
      const left = total - used;
      if (best === null || left > best) best = left;
    } catch {
      // unreadable — try the next key
    }
  }
  return best;
}

/**
 * Gate for a search of a given size. Returns null to proceed, or a sentence
 * explaining the refusal.
 *
 * Fails OPEN when no balance is readable — an OpenRouter outage must not stop
 * the product working, and a real 402 is still handled downstream.
 */
export async function creditBlockerFor(targetSignals: number): Promise<string | null> {
  const need = requiredCreditFor(targetSignals);
  const left = await openRouterRemaining();
  if (left === null) return null;
  if (left >= need) return null;
  return (
    `Not enough OpenRouter credit for a search this size — $${left.toFixed(2)} left, ` +
    `about $${need.toFixed(2)} needed for ${targetSignals} results. ` +
    `Top up in Settings, or run a smaller search.`
  );
}

/**
 * Returns null when good to go, or a human sentence explaining why not.
 *
 * Fails OPEN on an unreadable balance: if OpenRouter's own API is down we do
 * not know that credit is exhausted, and refusing to run on "I could not
 * check" would turn their outage into our missed week. A real 402 mid-run is
 * still handled downstream — this is an optimisation to avoid pointless spend,
 * not the safety net itself.
 */
export async function preflightBlocker(): Promise<string | null> {
  const [primary, fallback] = await Promise.all([
    resolveSetting("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY),
    resolveSetting("OPENROUTER_API_KEY_2", process.env.OPENROUTER_API_KEY_2),
  ]);
  if (!primary && !fallback) {
    return "No OpenRouter key is configured, so nothing can be classified. Add one in Settings.";
  }

  let anyReadable = false;
  for (const key of [primary, fallback].filter(Boolean) as string[]) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as Credits;
      const total = body.data?.total_credits;
      const used = body.data?.total_usage;
      if (typeof total !== "number" || typeof used !== "number") continue;
      anyReadable = true;
      // A few cents is not enough for a run but is enough to look "not
      // exhausted", so require real headroom rather than a positive balance.
      if (total - used > 0.5) return null;
    } catch {
      // Unreadable — try the next key.
    }
  }

  if (!anyReadable) return null; // fail open, see above
  return "Skipped: OpenRouter credit is exhausted, so no company could be classified. Top it up and the next run will go ahead.";
}

/** Records the cron's outcome where the dashboard can read it. */
export async function recordHarvestHealth(h: HarvestHealth): Promise<void> {
  try {
    await setSetting(HEALTH_KEY, JSON.stringify(h));
  } catch {
    // Never let bookkeeping fail a run.
  }
}

export async function readHarvestHealth(): Promise<HarvestHealth | null> {
  try {
    const raw = await getSettingFresh(HEALTH_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as Partial<HarvestHealth>;
    if (typeof h.at !== "string" || typeof h.reason !== "string") return null;
    return { at: h.at, ok: h.ok === true, reason: h.reason, started: h.started };
  } catch {
    return null;
  }
}
