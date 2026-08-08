import { resolveSetting, getSettingFresh, setSetting } from "../settings";
import { OPENROUTER_2_CAP_USD, BASELINE_SETTING } from "./openrouter";

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

/**
 * Best SPENDABLE balance across the configured keys, or null if unreadable.
 *
 * "Spendable" is the important word, and getting it wrong is a bug this code
 * shipped with for a few hours. There are TWO independent ceilings on the
 * fallback key and they move separately:
 *
 *   1. the account's own balance (total_credits - total_usage)
 *   2. OUR self-imposed $5 delta cap in openrouter.ts, measured from a stored
 *      baseline — because that account belongs to a third party and this app
 *      is only allowed to spend $5 of it
 *
 * A first version checked only (1). The account showed $3.43 remaining, the
 * gate said "go", and then every classify call was refused by (2) — which was
 * already at $5.05 of $5. The search still paid Apify for discovery, then
 * rejected 15 companies with "Classification failed". Worst of both: money
 * spent, no product, and rejection reasons that blamed the companies.
 *
 * So the answer is the MINIMUM of the two, per key.
 */
export async function openRouterRemaining(): Promise<number | null> {
  const [primary, fallback] = await Promise.all([
    resolveSetting("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY),
    resolveSetting("OPENROUTER_API_KEY_2", process.env.OPENROUTER_API_KEY_2),
  ]);

  const read = async (key: string, capped: boolean): Promise<number | null> => {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const b = (await res.json()) as Credits;
      const total = b.data?.total_credits;
      const used = b.data?.total_usage;
      if (typeof total !== "number" || typeof used !== "number") return null;
      const accountLeft = total - used;
      if (!capped) return accountLeft;
      // Headroom under our own delta cap, which the pipeline enforces.
      const baseline = Number(await getSettingFresh(BASELINE_SETTING));
      if (!Number.isFinite(baseline) || baseline <= 0) return accountLeft;
      const capLeft = OPENROUTER_2_CAP_USD - (used - baseline);
      return Math.min(accountLeft, capLeft);
    } catch {
      return null;
    }
  };

  const values = (
    await Promise.all([
      primary ? read(primary, false) : Promise.resolve(null),
      fallback ? read(fallback, true) : Promise.resolve(null),
    ])
  ).filter((v): v is number => v !== null);

  return values.length ? Math.max(...values) : null;
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

  // Uses the SPENDABLE figure — account balance AND our own delta cap, whichever
  // binds first. See openRouterRemaining for why checking only the former let a
  // whole run through to fail on the latter.
  const left = await openRouterRemaining();
  if (left === null) return null; // fail open, see above
  if (left > 0.5) return null;
  return "Skipped: no OpenRouter credit is available to classify with. Top it up and the next run will go ahead.";
}

/**
 * Gate for ENRICHMENT, which has its own vendors and its own way of failing.
 *
 * Enrichment is the only step that bills per PERSON, and it was the only step
 * with no pre-flight at all: pressing "all 124 leads" against an account with
 * 30 credits left would look up 30 addresses, then silently return nothing for
 * the remaining 94 — a half-enriched list with no indication which half.
 *
 * AnymailFinder is the binding constraint (~$0.05 and one credit per FOUND
 * address). MillionVerifier is checked too but rarely binds — it bills ~$0.006
 * and the account holds thousands.
 *
 * Fails OPEN on unreadable balances, same reasoning as the OpenRouter gate.
 */
export async function enrichmentBlockerFor(companyCount: number): Promise<string | null> {
  const [amfKey, mvKey] = await Promise.all([
    resolveSetting("ANYMAILFINDER_API_KEY", process.env.ANYMAILFINDER_API_KEY),
    resolveSetting("MILLIONVERIFIER_API_KEY", process.env.MILLIONVERIFIER_API_KEY),
  ]);
  if (!amfKey) return "No AnymailFinder key is configured — add one in Settings before finding emails.";

  try {
    const res = await fetch("https://api.anymailfinder.com/v5.0/meta/account.json", {
      headers: { Authorization: `Bearer ${amfKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const b = await res.json();
      // `credits_left` — the field lib/vendor-usage.ts already reads. A first
      // version guessed `results.credits_remaining`, found undefined, and
      // therefore let EVERY request through: it approved 5,000 lookups against
      // an account holding 388. A guard that silently fails open is worse than
      // no guard, because it reads as protection. Verified against the live
      // payload: {"credits_left":388,"credits_total":388,...}
      const credits = typeof b?.credits_left === "number" ? b.credits_left : null;
      if (credits !== null && credits < companyCount) {
        return (
          `Not enough AnymailFinder credits — ${credits} left, ${companyCount} companies to look up. ` +
          `Enrich the signals only, or top up.`
        );
      }
    }
  } catch {
    // unreadable — fail open
  }

  if (mvKey) {
    try {
      const res = await fetch(
        `https://api.millionverifier.com/api/v3/credits?api=${encodeURIComponent(mvKey)}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (res.ok) {
        const b = await res.json();
        const credits = typeof b?.credits === "number" ? b.credits : null;
        if (credits !== null && credits < companyCount) {
          return `Not enough MillionVerifier credits — ${credits} left, ${companyCount} to verify.`;
        }
      }
    } catch {
      // unreadable — fail open
    }
  }
  return null;
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
