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
export const SETTINGS_KEYS = [
  // Two Apify accounts, down from four (2026-08-07). Tokens 2 and 3 were
  // $5/mo free-tier accounts opened purely to keep test spend off the client's
  // own, and both ran fully dry within a day of being added. They are removed
  // rather than left in the chain: a dead token in a fallback list is not
  // free — every run still resolves it, and a chain that silently rotates onto
  // an exhausted account turns a billing problem into a mysterious 402 in the
  // middle of a search. This ends at one account; token 4 is the working one
  // today, and APIFY_TOKEN is the client's own, which is where it lands.
  {
    key: "APIFY_TOKEN_4",
    // Label has to track BUDGET_CAP_USD in lib/pipeline/apify.ts or it
    // contradicts the Vendor usage card above it.
    label: "Apify: active token ($29/mo plan, code-capped at $10)",
    envFallback: "APIFY_TOKEN_4",
  },
  {
    key: "APIFY_TOKEN",
    label: "Apify: client's own account (code-capped at $10)",
    envFallback: "APIFY_TOKEN",
  },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter", envFallback: "OPENROUTER_API_KEY" },
  { key: "OPENROUTER_API_KEY_2", label: "OpenRouter: fallback key ($5 capped)", envFallback: "OPENROUTER_API_KEY_2" },
  { key: "ANYMAILFINDER_API_KEY", label: "Anymailfinder", envFallback: "ANYMAILFINDER_API_KEY" },
  { key: "MILLIONVERIFIER_API_KEY", label: "MillionVerifier", envFallback: "MILLIONVERIFIER_API_KEY" },
  { key: "TAVILY_API_KEY", label: "Tavily (directory search)", envFallback: "TAVILY_API_KEY" },
  { key: "FIRECRAWL_API_KEY", label: "Firecrawl (JS-rendered page fallback)", envFallback: "FIRECRAWL_API_KEY" },
  // Model IDs, not secrets — same mechanism so they're switchable without a
  // redeploy. Flip CLASSIFY_MODEL to anthropic/claude-haiku-4.5 once the
  // 72-company benchmark proves it holds.
  { key: "CLASSIFY_MODEL", label: "Model: classify + disprove", envFallback: "CLASSIFY_MODEL" },
  { key: "EXTRACT_MODEL", label: "Model: directory extraction", envFallback: "EXTRACT_MODEL" },
] as const;
