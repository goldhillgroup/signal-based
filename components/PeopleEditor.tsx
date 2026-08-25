"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PersonRole } from "@/lib/supabase/types";
import { TrashIcon } from "./icons";

/**
 * Who is at this company, and which of them the next lookup pays for.
 *
 * A company used to carry exactly two names because the first brief described
 * two people. Jonathan hit the limit on his first real pass: a builder with a
 * founder and two sons could only ever have one of them looked up, and which
 * one was decided by whichever the classifier happened to write first. He
 * could see it was wrong and had no way to act on it.
 *
 * GRACEFUL WHEN THE TABLE IS NOT THERE. This ships before its migration is
 * applied, so a 404 or a PostgREST "no such table" is not an error state to
 * show him — the parent falls back to the old two-field editor and the app
 * carries on. Shipping a feature that takes the drawer down until somebody
 * runs a SQL file is worse than shipping it dark.
 */

export interface Person {
  id: string;
  name: string;
  title: string | null;
  role: PersonRole;
  is_target: boolean;
  source: "crawler" | "user";
}

const ROLE_LABEL: Record<PersonRole, string> = {
  founder: "Founder",
  next_gen: "Next generation",
  other: "Also there",
};

const ROLE_ORDER: PersonRole[] = ["founder", "next_gen", "other"];

export function PeopleEditor({
  companyId,
  onUnavailable,
  onChanged,
}: {
  companyId: string;
  /** The table is missing. The parent shows the older editor instead. */
  onUnavailable: () => void;
  onChanged?: () => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ name: string; title: string; role: PersonRole }>({
    name: "",
    title: "",
    role: "next_gen",
  });
  const router = useRouter();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/company/${companyId}/people`, { signal });
      if (!res.ok) throw new Error("unavailable");
      const json = await res.json();
      if (!Array.isArray(json?.people)) throw new Error("unavailable");
      if (!signal?.aborted) setPeople(json.people);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      onUnavailable();
    }
  }, [companyId, onUnavailable]);

  // Abort on unmount rather than letting a late response set state on a drawer
  // that has already closed, which is the usual way this pattern leaks.
  //
  // The lint rule below fires on any setState reachable from an effect. Here
  // every one of them is behind an await on a network response, which is the
  // case the rule exists to distinguish and cannot see through a useCallback.
  // Fetching on mount is the correct shape for this; the alternative is
  // hoisting the request into the parent, which moves the same effect one
  // level up and makes the drawer pay for it on every company.
  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  async function send(method: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/company/${companyId}/people`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "That did not save.");
      await load();
      onChanged?.();
      // The list behind the drawer is server-rendered and now stale.
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (people === null) {
    return <p className="text-xs text-gh-ink-muted">Loading people…</p>;
  }

  const sorted = [...people].sort(
    (a, b) =>
      Number(b.is_target) - Number(a.is_target) ||
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
  );

  return (
    <div className="space-y-2.5">
      {sorted.length === 0 && (
        <p className="text-xs text-gh-ink-muted">
          Nobody named on their site. Add whoever you found.
        </p>
      )}

      {sorted.map((p) => (
        <div
          key={p.id}
          className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${
            p.is_target ? "border-gh-sky/50 bg-gh-sky/[0.06]" : "border-gh-border"
          }`}
        >
          {/* A radio, not a checkbox: exactly one person is bought for, and the
              database enforces that with a partial unique index. Offering a
              shape the data cannot hold would be a lie about what happens. */}
          <input
            type="radio"
            name={`target-${companyId}`}
            checked={p.is_target}
            disabled={busy}
            onChange={() => send("PATCH", { person_id: p.id, is_target: true })}
            aria-label={`Look up ${p.name}`}
            className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-gh-sky"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gh-ink">{p.name}</p>
            <p className="truncate text-[11px] text-gh-ink-muted">
              {ROLE_LABEL[p.role]}
              {p.title ? ` · ${p.title}` : ""}
              {p.source === "user" ? " · added by you" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => send("DELETE", { person_id: p.id })}
            disabled={busy}
            aria-label={`Remove ${p.name}`}
            title="Remove"
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-gh-ink-muted transition-colors hover:bg-gh-critical/10 hover:text-gh-critical disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-critical/30"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="space-y-2 rounded-lg border border-gh-border p-2.5">
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Name"
              maxLength={120}
              aria-label="New person name"
              // 16px on mobile, or iOS zooms on focus and will not zoom back.
              className="min-w-0 flex-[3] rounded-lg border border-gh-border bg-gh-surface-sunken px-2 py-1.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/25 sm:text-sm"
            />
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Title"
              maxLength={120}
              aria-label="New person title"
              className="min-w-0 flex-[2] rounded-lg border border-gh-border bg-gh-surface-sunken px-2 py-1.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/25 sm:text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {ROLE_ORDER.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, role: r }))}
                aria-pressed={draft.role === r}
                className={`cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
                  draft.role === r
                    ? "border-gh-sky bg-gh-sky/10 text-gh-ink"
                    : "border-gh-border text-gh-ink-muted hover:text-gh-ink"
                }`}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || draft.name.trim().length === 0}
              onClick={async () => {
                const ok = await send("POST", draft);
                if (ok) {
                  setDraft({ name: "", title: "", role: "next_gen" });
                  setAdding(false);
                }
              }}
              className="cursor-pointer rounded-lg bg-gh-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
            >
              {busy ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
              className="cursor-pointer text-[11px] text-gh-ink-muted underline-offset-2 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="cursor-pointer rounded-lg border border-dashed border-gh-border px-3 py-1.5 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/50 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          + Add someone
        </button>
      )}

      {error && <p className="text-[11px] text-gh-critical">{error}</p>}

      {sorted.length > 0 && (
        <p className="text-[11px] leading-relaxed text-gh-ink-muted">
          Find emails buys an address for the person selected above. To get one
          for everybody here, tick “look up everyone” when you start it.
        </p>
      )}
    </div>
  );
}
