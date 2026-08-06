import type { VerificationStatus } from "../supabase/types";
import { resolveSetting } from "../settings";

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
  const res = await fetch(url);
  if (!res.ok) return "unknown";
  const data = await res.json().catch(() => null);
  const result = data?.result as string | undefined;
  return (result && RESULT_MAP[result]) || "unknown";
}
