import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setSetting, SETTINGS_KEYS } from "@/lib/settings";
import { validateSecret } from "@/lib/settings-validate";

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

  // OpenRouter will say at once whether it accepts the key, and the answer also
  // names the account it belongs to, which is what settles "did my top-up go to the
  // right account". A network failure does not block saving: that says nothing
  // about the key.
  if (key === "OPENROUTER_API_KEY") {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${trimmed}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (res && (res.status === 401 || res.status === 403)) {
      return NextResponse.json(
        {
          error:
            "OpenRouter does not accept that key (HTTP " + res.status + "). Create a new one at openrouter.ai/settings/keys " +
            "while signed in to the account that holds your credits, and paste that. Nothing was saved, and the key that was here is untouched.",
        },
        { status: 400 }
      );
    }
  }

  await setSetting(key, trimmed);
  return NextResponse.json({ ok: true });
}
