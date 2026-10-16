/**
 * Ask the vendor whether a key works, BEFORE it replaces the one that is saved.
 *
 * On 2026-10-14 the OpenRouter key in Settings was overwritten with "25" and every
 * search failed with HTTP 401. Format checks (settings-validate.ts) stop the obvious
 * mistakes; this stops the rest, a key that looks right but is revoked, mistyped,
 * for a closed account, or the wrong vendor's, by asking the vendor itself. Each
 * request is one of the free account lookups the balance cards already use, so it
 * spends nothing.
 *
 * The rule is: save only a key the vendor confirms.
 *   valid        the vendor accepted it                              -> save
 *   invalid      the vendor refused it (401/403, or its own error)    -> refuse
 *   unreachable  timeout, network error, 5xx or 429: it could not say  -> refuse, try again
 *   unknown      an unexpected 4xx (our endpoint may have moved)       -> save, and warn;
 *                that says nothing about the key, and refusing every key on a vendor's
 *                API change would lock the page
 * The key itself is never put in a message or a log.
 */

export type KeyVerdict =
  | { verdict: "valid" }
  | { verdict: "invalid"; message: string }
  | { verdict: "unreachable"; message: string }
  | { verdict: "unknown" };

interface Probe {
  vendor: string;
  url: (key: string) => string;
  headers?: (key: string) => Record<string, string>;
  /** For vendors that answer 200 with an error body instead of a 4xx. Returns a reason if the body says the key is bad. */
  rejectedBy?: (body: unknown) => string | null;
  where: string;
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

const PROBES: Record<string, Probe> = {
  OPENROUTER_API_KEY: {
    vendor: "OpenRouter",
    url: () => "https://openrouter.ai/api/v1/key",
    headers: bearer,
    where: "Create one at openrouter.ai/settings/keys, signed in to the account that holds your credits.",
  },
  APIFY_TOKEN: {
    vendor: "Apify",
    url: (k) => `https://api.apify.com/v2/users/me?token=${encodeURIComponent(k)}`,
    where: "Copy it from Apify → Settings → API & Integrations.",
  },
  TAVILY_API_KEY: {
    vendor: "Tavily",
    url: () => "https://api.tavily.com/usage",
    headers: bearer,
    where: "Copy it from your Tavily dashboard (app.tavily.com).",
  },
  FIRECRAWL_API_KEY: {
    vendor: "Firecrawl",
    url: () => "https://api.firecrawl.dev/v1/team/credit-usage",
    headers: bearer,
    where: "Copy it from your Firecrawl dashboard.",
  },
  ANYMAILFINDER_API_KEY: {
    vendor: "AnymailFinder",
    url: () => "https://api.anymailfinder.com/v5.0/meta/account.json",
    headers: bearer,
    where: "Copy it from your AnymailFinder account settings.",
  },
  MILLIONVERIFIER_API_KEY: {
    vendor: "MillionVerifier",
    url: (k) => `https://api.millionverifier.com/api/v3/credits?api=${encodeURIComponent(k)}`,
    // Answers HTTP 200 with {"result":"error","error":"apikey_not_found"} for a junk key.
    rejectedBy: (b) => {
      const o = b as { credits?: unknown; error?: unknown } | null;
      if (o && typeof o.credits === "number") return null;
      return typeof o?.error === "string" ? o.error : "no credit balance in the answer";
    },
    where: "Copy it from your MillionVerifier dashboard (API section).",
  },
};

const TIMEOUT_MS = 8_000;

export async function checkKeyWithVendor(
  settingKey: string,
  value: string,
  fetchImpl: typeof fetch = fetch
): Promise<KeyVerdict> {
  const probe = PROBES[settingKey];
  if (!probe) return { verdict: "unknown" };

  let res: Response;
  try {
    res = await fetchImpl(probe.url(value), {
      headers: probe.headers?.(value),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return {
      verdict: "unreachable",
      message: `Could not reach ${probe.vendor} to check that key, so nothing was saved. Try again in a minute.`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      verdict: "invalid",
      message: `${probe.vendor} does not accept that key (HTTP ${res.status}), so nothing was saved and the key that was here is untouched. ${probe.where}`,
    };
  }
  if (res.status === 429 || res.status >= 500) {
    return {
      verdict: "unreachable",
      message: `${probe.vendor} could not check that key right now (HTTP ${res.status}), so nothing was saved. Try again in a minute.`,
    };
  }
  if (!res.ok) {
    console.warn(`Key check for ${probe.vendor} got an unexpected HTTP ${res.status}; saving without confirmation.`);
    return { verdict: "unknown" };
  }

  if (probe.rejectedBy) {
    const reason = probe.rejectedBy(await res.json().catch(() => null));
    if (reason) {
      return {
        verdict: "invalid",
        message: `${probe.vendor} does not accept that key (${reason}), so nothing was saved and the key that was here is untouched. ${probe.where}`,
      };
    }
  }
  return { verdict: "valid" };
}
