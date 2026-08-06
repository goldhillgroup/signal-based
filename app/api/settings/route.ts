import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setSetting, SETTINGS_KEYS } from "@/lib/settings";

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

  await setSetting(key, trimmed);
  return NextResponse.json({ ok: true });
}
