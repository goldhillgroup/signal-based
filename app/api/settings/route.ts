import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setSetting, SETTINGS_KEYS } from "@/lib/settings";
import { validateSecret } from "@/lib/settings-validate";
import { checkKeyWithVendor } from "@/lib/key-check";

const VALID_KEYS: Set<string> = new Set(SETTINGS_KEYS.map((k) => k.key));

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { key, value } = (await req.json().catch(() => ({}))) as {
    key?: string;
    value?: string;
  };

  if (!key || !VALID_KEYS.has(key)) {
    return NextResponse.json({ error: "Unknown settings key" }, { status: 400 });
  }
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Value cannot be blank" }, { status: 400 });
  }

  // Every setting here is a vendor key. Refuse a value that cannot be one BEFORE it
  // replaces a working key: on 2026-10-14 the OpenRouter key was overwritten with
  // "25" and every search failed with HTTP 401 until a new key was pasted in.
  const problem = validateSecret(key, trimmed);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // Then the vendor itself must confirm it, so a key that looks right but is revoked,
  // mistyped, for a closed account or another vendor's never replaces a working one.
  // See lib/key-check.ts for what counts as confirmed.
  const check = await checkKeyWithVendor(key, trimmed);
  if (check.verdict === "invalid" || check.verdict === "unreachable") {
    return NextResponse.json({ error: check.message }, { status: 400 });
  }

  await setSetting(key, trimmed);
  return NextResponse.json({ ok: true });
}
