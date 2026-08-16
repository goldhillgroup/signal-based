import { resolveSetting, getSetting } from "./settings";
import { CLIENT_PLAN_USD } from "./pipeline/apify";

/**
 * Every vendor's balance, in one shape, so the Settings page can show them
 * side by side.
 *
 * The problem this solves: the pipeline spends money at six different
 * companies, each with its own dashboard, its own login, and its own idea of
 * what a "credit" is. Answering "can I run another search today?" meant
 * opening all six. Worse, three of them are MONTHLY quotas — being out of
 * Apify credit on the 20th is a very different fact from being out on the 2nd,
 * and none of the vendor dashboards volunteers "you're full again on the
 * 22nd" without digging. So every fetcher below reports a reset instant when
 * the vendor exposes one, and says plainly that there isn't one when it
 * doesn't.
 *
 * SERVER-ONLY. Every function here resolves a real API key (lib/settings.ts,
 * service-role) and calls a vendor with it. The only consumer is
 * app/api/vendor-usage/route.ts, which is auth-gated. A Client Component may
 * `import type` from this file — that is erased at build — but must never
 * import a value. (There's no `server-only` package in this project to enforce
 * that at build time; this comment is the contract.)
 */

export type WarnLevel = "ok" | "near" | "exhausted";

/** The parts of a card that are known before any network call happens. */
export interface VendorMeta {
  id: string;
  vendor: string;
  /** Where to go when the answer is "top this up" — the card links out. */
  dashboardUrl: string;
}

export interface VendorUsage extends VendorMeta {
  /** false = we could not read this vendor. `headline` then holds the reason. */
  ok: boolean;
  /**
   * The one line he came here for. Deliberately free text rather than a fixed
   * "X of Y" template: a metered vendor's real question is "how much have I
   * spent against my ceiling" while a prepaid vendor's is "how much is left".
   * Forcing both into one wording makes one of them read wrong.
   */
  headline: string;
  detail: string[];
  /**
   * 0-100, or null when the vendor exposes no denominator to divide by. Null
   * means the UI draws NO progress bar rather than inventing a plausible one.
   * Not clamped at 100 — an overspent account really is at 100.2%, and
   * warnLevel needs to see that.
   */
  percentUsed: number | null;
  /** ISO instant the quota is next full, or null when nothing refills. */
  resetsAt: string | null;
  /** Human form of the above: "full again Aug 22 (in 15 days)". */
  resetNote: string;
  warnLevel: WarnLevel;
}

// One vendor being slow must never hold up the other five. 10s is generous
// for what are all single-row balance lookups.
const TIMEOUT_MS = 10_000;

// >=90% of the binding limit is "start thinking about it", >=100% is "the next
// search will fail". Both measured against the SELF-IMPOSED cap wherever one
// exists, never the vendor's own plan ceiling — see fetchApify below.
const NEAR_PCT = 90;

type FetchOutcome<T> = { ok: true; data: T } | { ok: false; reason: string };

/**
 * GET + parse with a hard timeout. Never throws, and never puts the request
 * URL in the reason string — several of these vendors take the API key as a
 * query param, and a leaked reason would end up rendered in the browser.
 */
async function getJson<T>(
  url: string,
  headers?: Record<string, string>
): Promise<FetchOutcome<T>> {
  try {
    const res = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `vendor returned HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError") return { ok: false, reason: "no response within 10s" };
    return { ok: false, reason: "could not reach the API" };
  }
}

/**
 * A card for a vendor we could not read. warnLevel stays "ok" on purpose:
 * "I don't know" is not "you're fine" and not "you're out" either, so it must
 * not colour the card red or amber — the UI styles `ok: false` separately.
 */
export function unreadable(meta: VendorMeta, reason: string): VendorUsage {
  return {
    ...meta,
    ok: false,
    headline: reason,
    detail: [],
    percentUsed: null,
    resetsAt: null,
    resetNote: "",
    warnLevel: "ok",
  };
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const usd = (n: number) => `$${n.toFixed(2)}`;
const units = (n: number) => n.toLocaleString("en-US");

function pctUsed(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null;
  return Math.max(0, (used / limit) * 100);
}

function levelFor(percentUsed: number | null): WarnLevel {
  if (percentUsed === null) return "ok";
  if (percentUsed >= 100) return "exhausted";
  if (percentUsed >= NEAR_PCT) return "near";
  return "ok";
}

function formatDay(d: Date): string {
  // UTC on purpose: Apify's cycle boundaries are UTC midnights, so rendering
  // them in the server's local zone would slide the date by a day.
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Turns a billing-cycle END into the moment the quota is FULL again — which is
 * the question actually being asked ("when does it become full again?"), and
 * is not the same date. Apify reports its cycle end as 23:59:59.999 on the
 * last day, so echoing that raw would say "Aug 21" for a quota that is full on
 * Aug 22. The +1ms is the entire difference between those two answers.
 */
function refillFrom(endIso: string | undefined): { resetsAt: string; resetNote: string } | null {
  if (!endIso) return null;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return null;
  const refill = new Date(end.getTime() + 1);

  // Counted in whole CALENDAR days, not by dividing the raw millisecond gap.
  // Two vendors can refill on the same date at different times of day —
  // Apify at UTC midnight, Firecrawl at 18:34 — and the naive subtraction
  // rounds those to 15 and 16 days, so two cards both saying "Aug 22" would
  // disagree about how far away Aug 22 is.
  const days = utcDayNumber(refill) - utcDayNumber(new Date());
  const when =
    days < 0 ? "due now" : days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return { resetsAt: refill.toISOString(), resetNote: `full again ${formatDay(refill)} (${when})` };
}

function utcDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

// ── OpenRouter ────────────────────────────────────────────────────────────
// Prepaid credits, not a monthly plan: nothing here ever refills on a
// schedule, so both cards say so rather than leaving a blank where a date
// would go.

interface OpenRouterCredits {
  data?: { total_credits?: number; total_usage?: number };
}

const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";

async function fetchOpenRouterPrimary(meta: VendorMeta): Promise<VendorUsage> {
  const key = await resolveSetting("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY);
  if (!key) return unreadable(meta, "No key configured");

  const res = await getJson<OpenRouterCredits>(OPENROUTER_CREDITS_URL, {
    Authorization: `Bearer ${key}`,
  });
  if (!res.ok) return unreadable(meta, res.reason);

  const granted = num(res.data.data?.total_credits);
  const used = num(res.data.data?.total_usage);
  if (granted === null || used === null) return unreadable(meta, "Balance missing from the response");

  const left = granted - used;
  const percentUsed = pctUsed(used, granted);

  return {
    ...meta,
    ok: true,
    headline: `${usd(used)} of ${usd(granted)} used`,
    detail: [
      left > 0
        ? `${usd(left)} left.`
        : `Over by ${usd(Math.abs(left))}. Classify calls now come back 402 and a search refuses to start — there is no fallback key any more, by design.`,
      "Every classify and disprove call in a search bills here.",
    ],
    percentUsed,
    resetsAt: null,
    resetNote: "prepaid credits. Only a top-up refills this",
    warnLevel: levelFor(percentUsed),
  };
}

interface ApifyLimits {
  data?: {
    monthlyUsageCycle?: { startAt?: string; endAt?: string };
    limits?: { maxMonthlyUsageUsd?: number };
    current?: { monthlyUsageUsd?: number };
  };
}

async function fetchApify(
  meta: VendorMeta,
  opts: {
    settingKey: string;
    envValue: string | undefined;
    /** Self-imposed ceiling, or null when Apify's own plan limit is the only one. */
    capUsd: number | null;
    /** Where this token sits in the fallback chain — see getApifyToken(). */
    role: string;
  }
): Promise<VendorUsage | null> {
  const token = await resolveSetting(opts.settingKey, opts.envValue);
  if (!token) return null;

  // /users/me/limits, not /users/me/usage/monthly. It returns the spend, the
  // plan ceiling AND the cycle in one small payload (the usage endpoint omits
  // the ceiling and buries the total under ~500 lines of per-service
  // breakdown), and — the part that actually matters — `current.
  // monthlyUsageUsd` is the exact field assertUnderBudget() gates a run on.
  // The card therefore shows the number that stops a search, not a
  // near-identical one from a neighbouring endpoint. Probed live against
  // usage/monthly's totalUsageCreditsUsdAfterVolumeDiscount on all four
  // tokens: identical to 6 decimal places.
  const res = await getJson<ApifyLimits>(
    `https://api.apify.com/v2/users/me/limits?token=${encodeURIComponent(token)}`
  );
  if (!res.ok) return unreadable(meta, res.reason);

  const d = res.data.data;
  const used = num(d?.current?.monthlyUsageUsd);
  if (used === null) return unreadable(meta, "Usage missing from the response");

  const planMax = num(d?.limits?.maxMonthlyUsageUsd);
  // The SELF-IMPOSED cap is the denominator whenever there is one. $10 stops a
  // run stone dead on an account whose plan would happily allow $29, so
  // measuring against $29 would answer a question nobody asked and show 78% of
  // headroom left on a token that's about to refuse. The plan number still
  // gets said out loud in the detail lines — it's context, not the limit.
  const limit = opts.capUsd ?? planMax;
  const percentUsed = pctUsed(used, limit);

  const detail: string[] = [opts.role];
  // The ceiling used to be a code constant BELOW the plan, guarding a borrowed
  // developer account. That account is gone, so the cap and the plan are the
  // same number and describing it as "self-imposed" was telling the reader
  // about a limit that no longer exists.
  if (opts.capUsd !== null && planMax !== null && opts.capUsd < planMax) {
    detail.push(
      `The ${usd(opts.capUsd)} ceiling is set in the code. Apify itself would allow ${usd(planMax)}/mo, so the code cap is what stops a run first.`
    );
  } else if (planMax !== null) {
    detail.push(`${usd(planMax)}/mo ceiling, enforced by Apify itself.`);
  }
  const startAt = d?.monthlyUsageCycle?.startAt;
  if (startAt && !Number.isNaN(new Date(startAt).getTime())) {
    detail.push(`Billing cycle started ${formatDay(new Date(startAt))}.`);
  }

  const refill = refillFrom(d?.monthlyUsageCycle?.endAt);

  return {
    ...meta,
    ok: true,
    headline:
      limit === null
        ? `${usd(used)} used this cycle`
        : `${usd(used)} of ${usd(limit)} ${opts.capUsd !== null ? "cap" : "plan"} used`,
    detail,
    percentUsed,
    resetsAt: refill?.resetsAt ?? null,
    resetNote: refill?.resetNote ?? "resets monthly, cycle dates unavailable",
    warnLevel: levelFor(percentUsed),
  };
}

// ── Tavily ────────────────────────────────────────────────────────────────

interface TavilyUsage {
  key?: { usage?: number };
  account?: {
    current_plan?: string;
    plan_usage?: number;
    plan_limit?: number;
    paygo_usage?: number;
    paygo_limit?: number | null;
  };
}

async function fetchTavily(meta: VendorMeta): Promise<VendorUsage> {
  const key = await resolveSetting("TAVILY_API_KEY", process.env.TAVILY_API_KEY);
  if (!key) return unreadable(meta, "No key configured");

  const res = await getJson<TavilyUsage>("https://api.tavily.com/usage", {
    Authorization: `Bearer ${key}`,
  });
  if (!res.ok) return unreadable(meta, res.reason);

  const account = res.data.account;
  const planUsage = num(account?.plan_usage);
  if (planUsage === null) return unreadable(meta, "Usage missing from the response");
  const planLimit = num(account?.plan_limit);
  const keyUsage = num(res.data.key?.usage);
  const percentUsed = pctUsed(planUsage, planLimit);

  const detail: string[] = [];
  if (account?.current_plan) detail.push(`Plan: ${account.current_plan}.`);
  if (keyUsage !== null && keyUsage !== planUsage) {
    detail.push(`This key alone: ${units(keyUsage)}, the plan figure covers every key on the account.`);
  }
  detail.push("Directory discovery runs on this; a basic search is 1 credit.");
  // TREAT THIS NUMBER AS A FLOOR, NOT A TOTAL. Measured 2026-08-07: five
  // searches were issued in one session (all HTTP 200, one with a
  // guaranteed-novel query to rule out response caching) and this counter did
  // not move — checked at t+0s, +45s, +60s, +180s and ~30min. Independently,
  // four earlier runs wrote 9 new directory_sources rows, and a row can only
  // be written after a search returns results, so at least 9 searches had
  // succeeded while this field read 4. Our own per-run meter
  // (cost-tracker.ts) counts billable responses and is the number to trust.
  detail.push(
    "Note: Tavily's own counter has been observed not to update, treat it as a floor. Our per-search cost breakdown is the reliable count."
  );
  const paygoLimit = num(account?.paygo_limit ?? null);
  if (paygoLimit !== null) {
    detail.push(`Pay-as-you-go on top: ${units(num(account?.paygo_usage) ?? 0)} of ${units(paygoLimit)}.`);
  }

  return {
    ...meta,
    ok: true,
    headline:
      planLimit === null
        ? `${units(planUsage)} credits used`
        : `${units(planUsage)} of ${units(planLimit)} credits used`,
    detail,
    percentUsed,
    // Tavily's usage endpoint returns counts and no dates. The quota is
    // monthly, but the DAY is not in the payload — so this says "monthly" and
    // stops there rather than inventing a date that would be wrong most
    // months. An honest gap beats a confident guess.
    resetsAt: null,
    resetNote: "resets monthly, Tavily's API doesn't return the date",
    warnLevel: levelFor(percentUsed),
  };
}

// ── Firecrawl ─────────────────────────────────────────────────────────────

interface FirecrawlUsage {
  success?: boolean;
  data?: {
    remaining_credits?: number;
    plan_credits?: number;
    billing_period_start?: string;
    billing_period_end?: string;
  };
}

async function fetchFirecrawl(meta: VendorMeta): Promise<VendorUsage> {
  const key = await resolveSetting("FIRECRAWL_API_KEY", process.env.FIRECRAWL_API_KEY);
  if (!key) return unreadable(meta, "No key configured");

  const res = await getJson<FirecrawlUsage>("https://api.firecrawl.dev/v1/team/credit-usage", {
    Authorization: `Bearer ${key}`,
  });
  if (!res.ok) return unreadable(meta, res.reason);

  const remaining = num(res.data.data?.remaining_credits);
  if (remaining === null) return unreadable(meta, "Balance missing from the response");
  const planCredits = num(res.data.data?.plan_credits);

  // Firecrawl reports a BALANCE, not consumption, and the balance can sit
  // ABOVE the monthly grant — measured live: 1,467 remaining against a 1,000
  // plan, from rollover or a top-up. So `plan_credits - remaining` is not
  // "used this period"; it goes negative and would render as a bar running
  // backwards. Size the bar against the pool actually available instead, and
  // say plainly in the detail lines when the two disagree.
  const pool = planCredits === null ? remaining : Math.max(planCredits, remaining);
  const used = Math.max(0, pool - remaining);
  const percentUsed = pctUsed(used, pool);

  const detail: string[] = [];
  if (planCredits !== null) {
    detail.push(
      remaining > planCredits
        ? `Plan grants ${units(planCredits)}/mo and the balance is above that, credits have rolled over or been topped up, so "used this period" isn't derivable from what the API returns.`
        : `${units(used)} of the ${units(planCredits)}/mo plan used this period.`
    );
  }
  detail.push("Layer 2 of 3 in the page fetch, only JS-gated or bot-blocked sites ever reach it.");

  const refill = refillFrom(res.data.data?.billing_period_end);

  return {
    ...meta,
    ok: true,
    headline: `${units(remaining)} credits left`,
    detail,
    percentUsed,
    resetsAt: refill?.resetsAt ?? null,
    resetNote: refill?.resetNote ?? "resets monthly, billing period unavailable",
    warnLevel: levelFor(percentUsed),
  };
}

// ── Anymailfinder ─────────────────────────────────────────────────────────

interface AnymailfinderAccount {
  credits_left?: number;
  credits_total?: number;
  email?: string;
  success?: boolean;
}

async function fetchAnymailfinder(meta: VendorMeta): Promise<VendorUsage> {
  const key = await resolveSetting("ANYMAILFINDER_API_KEY", process.env.ANYMAILFINDER_API_KEY);
  if (!key) return unreadable(meta, "No key configured");

  // /v5.0/meta/account.json is the ONLY account endpoint this API answers.
  // /v5.0/users/me, /v5.0/account, /v4.1/account, /v5.1/meta/account.json,
  // /v5.0/credits and /v5.0/meta/{usage,plan,subscription,billing}.json all
  // return 404 — probed one by one against the live key, which is why the
  // path looks arbitrary. Don't "tidy" it.
  const res = await getJson<AnymailfinderAccount>(
    "https://api.anymailfinder.com/v5.0/meta/account.json",
    { Authorization: `Bearer ${key}` }
  );
  if (!res.ok) return unreadable(meta, res.reason);

  const left = num(res.data.credits_left);
  if (left === null) return unreadable(meta, "Balance missing from the response");
  const total = num(res.data.credits_total);
  const percentUsed = total === null ? null : pctUsed(total - left, total);

  const detail: string[] = [];
  if (res.data.email) detail.push(`Account: ${res.data.email}.`);
  detail.push("Charged only when a lookup returns an address, misses are free.");

  return {
    ...meta,
    ok: true,
    headline: total === null ? `${units(left)} credits left` : `${units(left)} of ${units(total)} credits left`,
    detail,
    percentUsed,
    // No renewal date anywhere in the payload, and no other endpoint exposes
    // one (see the probe list above). Point at the dashboard rather than
    // guess.
    resetsAt: null,
    resetNote: "renewal date isn't exposed by the API, check the dashboard",
    warnLevel: levelFor(percentUsed),
  };
}

// ── MillionVerifier ───────────────────────────────────────────────────────

interface MillionVerifierCredits {
  credits?: number;
  bulk_credits?: number;
  renewing_credits?: number;
  plan?: number;
  error?: string;
}

// MillionVerifier sells a prepaid pool with no stated total, so there's no
// denominator and the percentage thresholds every other card uses don't
// apply. Absolute runway is the honest substitute: one credit is one email
// verification, so this is roughly "500 more leads' worth left".
const MILLIONVERIFIER_LOW_CREDITS = 500;

async function fetchMillionVerifier(meta: VendorMeta): Promise<VendorUsage> {
  const key = await resolveSetting("MILLIONVERIFIER_API_KEY", process.env.MILLIONVERIFIER_API_KEY);
  if (!key) return unreadable(meta, "No key configured");

  const res = await getJson<MillionVerifierCredits>(
    `https://api.millionverifier.com/api/v3/credits?api=${encodeURIComponent(key)}`
  );
  if (!res.ok) return unreadable(meta, res.reason);

  // Unlike the other five, this API answers HTTP 200 with an `error` field on
  // a bad key instead of a 4xx (verified live: a junk key returns 200 and
  // {"result":"error","error":"apikey_not_found"}). getJson can't catch that,
  // so a missing `credits` number is the real failure signal here.
  const credits = num(res.data.credits);
  if (credits === null) {
    return unreadable(
      meta,
      res.data.error ? `Rejected by the API (${res.data.error})` : "Balance missing from the response"
    );
  }

  const renewing = num(res.data.renewing_credits) ?? 0;

  const detail: string[] = ["One credit verifies one email at the end of enrichment."];
  if (renewing > 0) detail.push(`${units(renewing)} of these renew monthly; the rest are prepaid.`);

  return {
    ...meta,
    ok: true,
    headline: `${units(credits)} credits left`,
    detail,
    percentUsed: null,
    resetsAt: null,
    resetNote:
      renewing > 0
        ? "part prepaid, part renewing, the prepaid share never resets"
        : "prepaid, no reset; the balance only goes up when you buy more",
    warnLevel: credits <= 0 ? "exhausted" : credits < MILLIONVERIFIER_LOW_CREDITS ? "near" : "ok",
  };
}

// ── The list ──────────────────────────────────────────────────────────────

interface VendorDescriptor extends VendorMeta {
  run: (meta: VendorMeta) => Promise<VendorUsage | null>;
}

/**
 * Ordered by where each vendor sits in a run — discovery, fetch, classify,
 * enrich — so the section reads like the pipeline rather than like an
 * alphabetised inventory.
 *
 * All four Apify tokens get their own card on purpose. They're four separate
 * accounts with four separate billing cycles, and the fallback chain is
 * exactly the thing that would otherwise require four Apify logins to see.
 * A `run` returning null (an unconfigured optional token) drops the card
 * entirely.
 */
export const VENDOR_FETCHERS: readonly VendorDescriptor[] = [
  {
    id: "openrouter-1",
    vendor: "OpenRouter",
    dashboardUrl: "https://openrouter.ai/settings/credits",
    run: fetchOpenRouterPrimary,
  },
  // ONE Apify card, down from four. Tokens 2 and 3 were $5/mo free-tier
  // accounts that ran dry. Token 4 was a developer's own account, tried FIRST
  // so that build-and-test spend stayed off the client's card — that fallback
  // is now deleted from lib/pipeline/apify.ts along with its $17 cap, because
  // the handover is done and it was somebody else's money.
  //
  // A card for a token nothing can spend would report a balance that means
  // nothing, so it goes with the code path.
  {
    id: "apify-1",
    vendor: "Apify, client's own account",
    dashboardUrl: "https://console.apify.com/billing",
    run: (meta) =>
      fetchApify(meta, {
        settingKey: "APIFY_TOKEN",
        envValue: process.env.APIFY_TOKEN,
        capUsd: CLIENT_PLAN_USD,
        role: "Every search bills here. There is no second Apify account.",
      }),
  },
  {
    id: "tavily",
    vendor: "Tavily",
    dashboardUrl: "https://app.tavily.com",
    run: fetchTavily,
  },
  {
    id: "firecrawl",
    vendor: "Firecrawl",
    dashboardUrl: "https://www.firecrawl.dev/app",
    run: fetchFirecrawl,
  },
  {
    id: "anymailfinder",
    vendor: "Anymailfinder",
    dashboardUrl: "https://app.anymailfinder.com",
    run: fetchAnymailfinder,
  },
  {
    id: "millionverifier",
    vendor: "MillionVerifier",
    dashboardUrl: "https://app.millionverifier.com",
    run: fetchMillionVerifier,
  },
];
