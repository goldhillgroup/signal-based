import { resolveSetting, setSetting } from "../settings";

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

function requiredCreditFor(targetSignals: number): number {
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
/**
 * Set when a KEY's own spend limit is what ran out, rather than the account
 * balance. It changes the advice completely — "top up" is wrong and wastes
 * someone's time when the account already holds credit and the ceiling is a
 * number in the dashboard next to the key.
 */
let keyCapBound = false;

export async function openRouterRemaining(): Promise<number | null> {
  keyCapBound = false;
  const key = await resolveSetting("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY);
  if (!key) return null;

  const read = async (key: string): Promise<number | null> => {
    try {
      // BOTH endpoints, because they answer different questions and the app
      // shipped for weeks reading only the first.
      //
      //   /credits  what the ACCOUNT has        {total_credits, total_usage}
      //   /key      what THIS KEY may spend     {limit, limit_remaining, usage}
      //
      // A key can carry its own spend limit set in the OpenRouter dashboard,
      // entirely independent of the account balance. Measured on the live key
      // the moment this was written: the account reported $8.07 available
      // while the key reported limit $5, usage $5.05, limit_remaining 0. So
      // the gate said "go", discovery ran and was billed, and then every
      // single classify call was refused — a folder of fetched companies with
      // nothing judged, which is the exact failure this function exists to
      // prevent.
      //
      // Same shape as the self-imposed delta cap documented above: whenever
      // there are two ceilings, the answer is the MINIMUM, never the friendlier
      // one.
      const [creditsRes, keyRes] = await Promise.all([
        fetch("https://openrouter.ai/api/v1/credits", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        }),
        fetch("https://openrouter.ai/api/v1/key", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null),
      ]);
      if (!creditsRes.ok) return null;
      const b = (await creditsRes.json()) as Credits;
      const total = b.data?.total_credits;
      const used = b.data?.total_usage;
      if (typeof total !== "number" || typeof used !== "number") return null;
      let accountLeft = total - used;

      // A key with no limit set reports limit: null — uncapped, so it does not
      // constrain anything and must not be read as zero.
      if (keyRes?.ok) {
        const k = (await keyRes.json()) as {
          data?: { limit?: number | null; limit_remaining?: number | null };
        };
        const limit = k.data?.limit;
        const remaining = k.data?.limit_remaining;
        if (typeof limit === "number" && typeof remaining === "number") {
          if (remaining < accountLeft) keyCapBound = true;
          accountLeft = Math.min(accountLeft, remaining);
        }
      }
      return accountLeft;
    } catch {
      return null;
    }
  };

  // ONE key, so one answer. This used to read two accounts and take the MAX —
  // the primary and a friend's fallback — which meant a healthy fallback could
  // wave through a search the primary could not pay for, and the delta cap on
  // the fallback was a third ceiling to reconcile. With the fallback deleted
  // there is exactly one account and exactly two ceilings on it, and the
  // minimum of those is the answer.
  return read(key);
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
  // Which ceiling ran out decides the advice. "Top up" is actively wrong when
  // the account holds credit and the limit is a number beside the key.
  if (keyCapBound) {
    return (
      `This OpenRouter key has hit its own spend limit, so no company could be judged — ` +
      `$${left.toFixed(2)} available against about $${need.toFixed(2)} needed for ${targetSignals} results. ` +
      `The ACCOUNT may still hold credit: the cap is on the key itself. ` +
      `Raise that key's limit in the OpenRouter dashboard, or paste a different key into Settings.`
    );
  }
  return (
    `Not enough OpenRouter credit for a search this size, $${left.toFixed(2)} left, ` +
    `about $${need.toFixed(2)} needed for ${targetSignals} results. ` +
    `Top up in Settings, or run a smaller search.`
  );
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
  if (!amfKey) return "No AnymailFinder key is configured, add one in Settings before finding emails.";

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
          `Not enough AnymailFinder credits, ${credits} left, ${companyCount} companies to look up. ` +
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
          return `Not enough MillionVerifier credits, ${credits} left, ${companyCount} to verify.`;
        }
      }
    } catch {
      // unreadable — fail open
    }
  }
  return null;
}

