import type { VerificationStatus } from "../supabase/types";
import { resolveSetting } from "../settings";
import { recordCost } from "./cost-tracker";

const RESULT_MAP: Record<string, VerificationStatus> = {
  ok: "valid",
  invalid: "invalid",
  catch_all: "risky",
  unknown: "unknown",
  disposable: "invalid",
};

// Editable from /dashboard/settings (DB value wins, falls through to the
// env var) — see lib/settings.ts.
async function getApiKey(): Promise<string> {
  const key = await resolveSetting("MILLIONVERIFIER_API_KEY", process.env.MILLIONVERIFIER_API_KEY);
  if (!key) throw new Error("MILLIONVERIFIER_API_KEY is not set");
  return key;
}

export async function verifyEmail(email: string): Promise<VerificationStatus> {
  const apiKey = await getApiKey();
  const url = `https://api.millionverifier.com/api/v3/?api=${apiKey}&email=${encodeURIComponent(
    email
  )}&timeout=15`;
  // COST METERING (see cost-tracker.ts): recorded here, immediately before the
  // request, exactly as tavily/firecrawl do — a credit is spent the moment the
  // check goes out, and getApiKey() has already thrown if there's no key, so
  // reaching this line means a billable request is genuinely being made. Not
  // gated on the result: unlike AnymailFinder, the charge doesn't depend on
  // the answer being useful, so an "unknown" verdict still cost money.
  // (Price is an ESTIMATE — see UNIT_USD.)
  recordCost("millionverifier_check");
  const res = await fetch(url);
  if (!res.ok) return "unknown";
  const data = await res.json().catch(() => null);
  const result = data?.result as string | undefined;
  return (result && RESULT_MAP[result]) || "unknown";
}
