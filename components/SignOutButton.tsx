"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "./ConfirmDialog";
import { ThemeToggle } from "./ThemeToggle";
import { LogOutIcon } from "./icons";

/**
 * Who is signed in, how the app looks, and how to leave.
 *
 * This used to be ONE button: a profile card showing Jonathan's photo, his
 * name and his email, with a settings-gear icon on the right — and clicking
 * anywhere on it signed you out immediately. Nothing about it said so. A card
 * that looks like a profile and is captioned with a gear reads as "account
 * settings", so the only way to discover what it did was to lose your session
 * doing it.
 *
 * Now the identity block is just text, and signing out is its own labelled
 * control that asks first. Sign-out is not destructive in the data sense, but
 * it is disruptive and completely invisible in advance, which is the same
 * problem from the user's side.
 */
export function SignOutButton({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleSignOut() {
    setConfirming(false);
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="border-t border-white/10 px-4 py-3">
      <ConfirmDialog
        open={confirming}
        title="Sign out of Signal Radar?"
        confirmLabel="Yes, sign out"
        cancelLabel="Stay signed in"
        onConfirm={handleSignOut}
        onCancel={() => setConfirming(false)}
        body={
          <p>
            Any search already running keeps going on the server, and everything
            found so far is saved. You will need your email and password to get
            back in.
          </p>
        }
      />

      <div className="flex items-center gap-3 px-1">
        <Image
          src="/brand/jonathan-goldhill.jpg"
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white/15"
        />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold text-white">Jonathan Goldhill</p>
          <p className="truncate text-[11px] text-white/50">{userEmail ?? "Founder & Coach"}</p>
        </div>
      </div>

      <div className="mt-3">
        <ThemeToggle />
      </div>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={loading}
        className="mt-2 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-white/60 transition-colors duration-200 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-60"
      >
        <LogOutIcon className="h-4 w-4 shrink-0" />
        {loading ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
