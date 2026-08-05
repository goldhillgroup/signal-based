"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SettingsIcon } from "./icons";

export function SignOutButton({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={loading}
      className="flex w-full items-center gap-3 border-t border-white/10 px-5 py-4 text-left transition-colors hover:bg-white/5 disabled:opacity-60"
    >
      <Image
        src="/brand/jonathan-goldhill.jpg"
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white/15"
      />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[13px] font-semibold">Jonathan Goldhill</p>
        <p className="truncate text-[11px] text-white/50">
          {loading ? "Signing out…" : userEmail ?? "Founder & Coach"}
        </p>
      </div>
      <SettingsIcon className="ml-auto h-4 w-4 shrink-0 text-white/40" />
    </button>
  );
}
