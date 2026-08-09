import { createServiceRoleClient } from "./supabase/server";

// API keys editable from /dashboard/settings instead of only via env vars —
// see supabase/migrations/20260806010000_app_settings.sql for why this table
// has zero RLS policies (service-role only, never touches the browser).

// Short TTL cache — a search touches this dozens of times (once per Apify/
// OpenRouter call), and a fresh DB round-trip on every single one is wasted
// latency for a value that changes maybe once a month. 30s is long enough to
// avoid hammering the table within one run, short enough that a just-saved
// Settings change takes effect on the very next search, not "eventually."
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: string | null; expiresAt: number }>();

export async function getSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const supabase = createServiceRoleClient();
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  const value = data?.value ?? null;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Cache-bypassing read, for values where "correct right now" beats "cheap".
 *
 * The 30s cache above exists for API KEYS: a single search resolves them dozens
 * of times and they change maybe monthly. Config read once per page load is the
 * opposite trade, and the cache actively lied about it — toggling the weekly
 * harvest on, saving it (verified in the database), then reloading showed it
 * back OFF, because the page read a stale cached copy. A settings screen that
 * discards what you just saved is worse than a slow one.
 */
export async function getSettingFresh(key: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  const value = data?.value ?? null;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// DB value wins when set; falls through to the env var otherwise — nothing
// breaks for a key that's never been touched in the Settings page.
export async function resolveSetting(key: string, envFallback?: string): Promise<string | null> {
  const dbValue = await getSetting(key);
  return dbValue || envFallback || null;
}

// The keys this app actually uses, in one place — the Settings page and the
// pipeline modules both read off this list so they can't drift apart.
/**
 * Every key the Settings page shows, with what it is FOR in plain words.
 *
 * `what` exists because a label alone left two rows unexplainable: "Model:
 * classify + disprove" told nobody anything, and a setting nobody understands
 * is a setting nobody dares touch. `logo` and `link` exist so getting or
 * topping up a key is one click rather than a search.
 *
 * `advanced: true` folds a row behind a disclosure. The two model IDs are not
 * secrets and not needed for the product to run; they are an escape hatch for
 * changing which model does the reading, and they belong out of the way of
 * the six keys that actually have to be filled in.
 */
export interface SettingKeyMeta {
  key: string;
  label: string;
  envFallback: string;
  /** One sentence: what breaks without it, or what it changes. */
  what: string;
  /** Local file in /public/vendor, or null for non-vendor settings. */
  logo: string | null;
  /** Where to get or top up this key. */
  link: string | null;
  linkLabel?: string;
  advanced?: boolean;
  /**
   * The vendor-usage card this key belongs to (see lib/vendor-usage.ts).
   *
   * Balance and key used to be two separate lists on the same page — "what is
   * left" at the top, "what the key is" at the bottom — so answering "Apify is
   * empty, where do I paste the new token" meant scrolling between two places
   * that never named each other. Joined by this, one card per vendor says what
   * it does, what it has left, and where the key goes.
   *
   * Absent for the model overrides: a model is not a vendor and has no balance.
   */
  usageId?: string;
}

export const SETTINGS_KEYS: readonly SettingKeyMeta[] = [
  {
    key: "OPENROUTER_API_KEY",
    usageId: "openrouter-1",
    label: "OpenRouter",
    envFallback: "OPENROUTER_API_KEY",
    what: "Reads every company page and decides whether it shows a real succession signal. Nothing works without this one.",
    logo: "/vendor/openrouter.png",
    link: "https://openrouter.ai/settings/credits",
    linkLabel: "Top up credits",
  },
  {
    key: "APIFY_TOKEN",
    usageId: "apify-1",
    label: "Apify",
    envFallback: "APIFY_TOKEN",
    what: "Finds companies through Google Maps and web search, and fetches pages other methods cannot reach.",
    logo: "/vendor/apify.png",
    link: "https://console.apify.com/billing",
    linkLabel: "Billing",
  },
  {
    key: "TAVILY_API_KEY",
    usageId: "tavily",
    label: "Tavily",
    envFallback: "TAVILY_API_KEY",
    what: "Finds the industry directories and association member lists that companies are listed on.",
    logo: "/vendor/tavily.png",
    link: "https://app.tavily.com",
    linkLabel: "Dashboard",
  },
  {
    key: "FIRECRAWL_API_KEY",
    usageId: "firecrawl",
    label: "Firecrawl",
    envFallback: "FIRECRAWL_API_KEY",
    what: "Reads pages that only render with JavaScript, which a plain fetch sees as empty.",
    logo: "/vendor/firecrawl.png",
    link: "https://www.firecrawl.dev/app",
    linkLabel: "Dashboard",
  },
  {
    key: "ANYMAILFINDER_API_KEY",
    usageId: "anymailfinder",
    label: "Anymailfinder",
    envFallback: "ANYMAILFINDER_API_KEY",
    what: "Finds an email address for the person behind a company. Only runs when you press Find emails.",
    logo: "/vendor/anymailfinder.png",
    link: "https://app.anymailfinder.com",
    linkLabel: "Dashboard",
  },
  {
    key: "MILLIONVERIFIER_API_KEY",
    usageId: "millionverifier",
    label: "MillionVerifier",
    envFallback: "MILLIONVERIFIER_API_KEY",
    what: "Checks a found email is deliverable before it reaches your list.",
    logo: "/vendor/millionverifier.png",
    link: "https://app.millionverifier.com",
    linkLabel: "Dashboard",
  },
  // APIFY_TOKEN_4 is not offered either. It is a developer escape hatch — a
  // second Apify account used before the client's own plan, so spend can be
  // kept off his card during testing. Nothing about the product he is buying
  // needs it, and a settings page listing "second account" invites the
  // question of why there is one. Still read by getApifyToken via
  // resolveSetting, so it works exactly as before when the env var is set.

  // THE TWO MODEL PICKERS ARE GONE FROM THIS LIST, deliberately.
  //
  // They offered a free-text box for the model that reads every company page
  // and decides whether a succession signal is real — with a caption admitting
  // "changing it changes the quality of every lead". That is a control whose
  // own description says not to touch it, in front of a client whose entire
  // purchase is that judgement. A typo silently degrades every future search,
  // and nothing in the product would report it.
  //
  // The capability is unchanged: getClassifyModel/getExtractModel still read
  // CLASSIFY_MODEL and EXTRACT_MODEL through resolveSetting, so the model can
  // still be switched by setting the env var or writing the row directly. It
  // is simply not a button on a page he uses to top up credit. Benchmark
  // first — eval-labeled.mts runs the 72-company set — then change it
  // deliberately, not from a settings screen.
] as const;
