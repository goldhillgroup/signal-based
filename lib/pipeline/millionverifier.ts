import type { VerificationStatus } from "../supabase/types";

const MILLIONVERIFIER_API_KEY = process.env.MILLIONVERIFIER_API_KEY;

const RESULT_MAP: Record<string, VerificationStatus> = {
  ok: "valid",
  invalid: "invalid",
  catch_all: "risky",
  unknown: "unknown",
  disposable: "invalid",
};

export async function verifyEmail(email: string): Promise<VerificationStatus> {
  if (!MILLIONVERIFIER_API_KEY) throw new Error("MILLIONVERIFIER_API_KEY is not set");
  const url = `https://api.millionverifier.com/api/v3/?api=${MILLIONVERIFIER_API_KEY}&email=${encodeURIComponent(
    email
  )}&timeout=15`;
  const res = await fetch(url);
  if (!res.ok) return "unknown";
  const data = await res.json().catch(() => null);
  const result = data?.result as string | undefined;
  return (result && RESULT_MAP[result]) || "unknown";
}
