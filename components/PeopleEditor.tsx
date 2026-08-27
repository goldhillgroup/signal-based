"use client";

import { useEffect, useRef, useState } from "react";
import { TrashIcon } from "./icons";

/**
 * Who is at this company, and which one the next lookup pays for.
 *
 * WHY IT EXISTS. Two name slots, founder and next generation, and Jonathan
 * opened Hansmann Construction to find four people worth listing: he corrected
 * the founder, then Dave (another son) and Julie turned up as well. He had to
 * delete one to make room for another. Enrichment buys an address for one
 * person, and which one was decided by whichever the classifier wrote first,
 * so the wrong name did not merely look wrong -- it spent five cents on the
 * wrong person and filed the result as if it were right.
 *
 * Five slots, and an explicit choice of who gets bought for.
 *
 * WHAT IS NOT EDITABLE, deliberately: the quote, the source URL, the verdict.
 * Those are the record of what the crawler actually read, and a product whose
 * whole claim is "check this against the live page" cannot let the evidence be
 * rewritten. Who to call is a judgement Jonathan is better placed to make than
 * the model. What the page said is a fact.
 */

interface Person {
  id: string | null;
  name: string;
  title: string | null;
  origin: "founder" | "next_gen" | "user";
  isTarget: boolean;
  email: string | null;
}

const ROLE_LABEL: Record<Person["origin"], string> = {
  founder: "Founder",
  next_gen: "Next generation",
  user: "Added by you",
};

export function PeopleEditor({
  companyId,
  onChanged,
}: {
  companyId: string;
  onChanged?: () => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [max, setMax] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // READ-ONLY UNTIL YOU PRESS EDIT.
  //
  // Every row carried its own radio, its own delete and a permanent "Add a
  // person" button, so a panel that is mostly READ -- who runs this company --
  // looked like a form being filled in. Daniel asked for the pattern used
  // everywhere else: one Edit, which turns the section into an editor, and
  // where adding somebody belongs.
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTitle, setDraftTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/company/${companyId}/people`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setPeople(json?.people ?? []);
        if (typeof json?.max === "number") setMax(json.max);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function send(method: "POST" | "PATCH" | "DELETE", body: unknown) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/company/${companyId}/people`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "That did not work.");
      if (json.people) setPeople(json.people);
      onChanged?.();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Editing one of the two crawler slots writes to the company columns; a
   * hand-added person writes to their own row. The caller does not need to
   * know which, so it is decided here from where the person came.
   */
  async function saveEdit(p: Person, name: string, title: string) {
    if (p.origin === "user" && p.id) {
      return send("PATCH", { contact_id: p.id, name, title });
    }
    const prefix = p.origin === "founder" ? "founder" : "next_gen";
    return send("PATCH", { [`${prefix}_name`]: name, [`${prefix}_title`]: title });
  }

  if (people === null) {
    return <p className="text-xs text-gh-ink-muted">Reading the people…</p>;
  }

  const full = people.length >= max;

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            {people.length === 0 && (
              <p className="text-xs text-gh-ink-muted">Nobody is named on this one.</p>
            )}
            {people.map((p) => (
              <div key={`${p.id ?? p.origin}-${p.name}`} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gh-ink">{p.name}</span>
                  <span className="ml-1.5 text-[11px] text-gh-ink-muted">
                    {p.title ?? ROLE_LABEL[p.origin]}
                  </span>
                </span>
                {/* Marked, not explained: the sentence under the editor says
                    what the tick means, and repeating it on every row would
                    bury the names it is meant to annotate. */}
                {p.isTarget && (
                  <span className="shrink-0 rounded-full bg-gh-sky/10 px-2 py-0.5 text-[10px] font-semibold text-gh-navy">
                    gets the email
                  </span>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 cursor-pointer rounded-lg border border-gh-border px-2.5 py-1 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/50 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {people.length === 0 && (
        <p className="text-xs text-gh-ink-muted">
          Nobody is named on this one yet. Add whoever you found.
        </p>
      )}

      {people.map((p, i) => (
        <PersonRow
          // Name and title in the key: the row holds them in local state
          // while being edited, so it must remount when the saved values
          // change rather than syncing them across in an effect.
          key={`${p.id ?? p.origin}-${p.name}-${p.title ?? ""}`}
          person={p}
          busy={busy}
          onSave={(name, title) => saveEdit(p, name, title)}
          onTarget={() => send("PATCH", { target: { name: p.name, title: p.title } })}
          onDelete={p.id ? () => send("DELETE", { contact_id: p.id }) : undefined}
        />
      ))}

      {adding ? (
        <div className="rounded-lg border border-gh-sky/40 bg-gh-surface-sunken p-2.5">
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Name"
              maxLength={120}
              aria-label="New person name"
              // 16px on mobile, or iOS zooms in on focus and will not zoom back.
              className="min-w-0 flex-[3] rounded-lg border border-gh-border bg-gh-surface px-2 py-1.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
            />
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Title"
              maxLength={120}
              aria-label="New person title"
              className="min-w-0 flex-[2] rounded-lg border border-gh-border bg-gh-surface px-2 py-1.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || draftName.trim().length === 0}
              onClick={async () => {
                const ok = await send("POST", { name: draftName, title: draftTitle });
                if (ok) {
                  setDraftName("");
                  setDraftTitle("");
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
                setDraftName("");
                setDraftTitle("");
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
          disabled={full || busy}
          onClick={() => setAdding(true)}
          title={full ? `Five people is the limit on one company.` : undefined}
          className="cursor-pointer rounded-lg border border-dashed border-gh-border px-3 py-1.5 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/50 hover:text-gh-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          {full ? `${people.length} of ${max}, that is the limit` : "Add a person"}
        </button>
      )}

      {error && <p className="text-[11px] text-gh-critical">{error}</p>}

      {/* The consequence of the radio, said where the radio is. Which person
          is ticked decides who a paid lookup is spent on. */}
      <p className="pt-0.5 text-[11px] leading-relaxed text-gh-ink-muted">
        Find personal emails looks up whoever is ticked. Tick a different person
        to change who it buys an address for.
      </p>

      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setAdding(false);
          setError("");
        }}
        className="cursor-pointer rounded-lg border border-gh-border px-2.5 py-1 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/50 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
      >
        Done
      </button>
    </div>
  );
}

function PersonRow({
  person,
  busy,
  onSave,
  onTarget,
  onDelete,
}: {
  person: Person;
  busy: boolean;
  onSave: (name: string, title: string) => Promise<boolean>;
  onTarget: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [title, setTitle] = useState(person.title ?? "");
  const [editing, setEditing] = useState(false);

  const dirty = name.trim() !== person.name || title.trim() !== (person.title ?? "");

  // Closing the drawer unmounts these inputs without them ever blurring, so a
  // correction typed and then dismissed would be lost. The ref holds the
  // latest values because the cleanup closes over the first render otherwise.
  const pending = useRef({ dirty: false, name: "", title: "" });
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    pending.current = {
      dirty: dirty && editing && name.trim().length > 0,
      name: name.trim(),
      title: title.trim(),
    };
    onSaveRef.current = onSave;
  });
  useEffect(
    () => () => {
      const q = pending.current;
      if (q.dirty) void onSaveRef.current(q.name, q.title);
    },
    []
  );

  return (
    <div
      className={`rounded-lg border p-2.5 transition-colors ${
        person.isTarget ? "border-gh-sky/50 bg-gh-sky/[0.04]" : "border-gh-border"
      }`}
      // Same rule as the drawer: clicking away commits, so a correction typed
      // and abandoned is not silently thrown away.
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (!editing || !dirty || !name.trim()) return;
        void onSave(name.trim(), title.trim()).then(() => setEditing(false));
      }}
    >
      <div className="flex items-start gap-2">
        <input
          type="radio"
          name={`target-${person.origin}-${person.id ?? person.name}`}
          checked={person.isTarget}
          onChange={onTarget}
          disabled={busy}
          aria-label={`Look up an email for ${person.name}`}
          className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-gh-navy"
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                aria-label={`${person.name} name`}
                className="min-w-0 flex-[3] rounded border border-gh-border bg-gh-surface-sunken px-1.5 py-1 text-base text-gh-ink focus:border-gh-sky focus:outline-none sm:text-sm"
              />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                maxLength={120}
                aria-label={`${person.name} title`}
                className="min-w-0 flex-[2] rounded border border-gh-border bg-gh-surface-sunken px-1.5 py-1 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="block w-full cursor-text text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
            >
              <span className="block truncate text-sm font-medium text-gh-ink">{person.name}</span>
              <span className="block truncate text-[11px] text-gh-ink-muted">
                {/* "Founder · Founder" was what this produced whenever the
                    title the page gave matched the slot it sits in, which for
                    a founder is most of the time. */}
                {[
                  ROLE_LABEL[person.origin],
                  person.title && person.title.toLowerCase() !== ROLE_LABEL[person.origin].toLowerCase()
                    ? person.title
                    : null,
                  person.email,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          )}
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            aria-label={`Remove ${person.name}`}
            title="Remove"
            className="shrink-0 cursor-pointer rounded p-1 text-gh-ink-muted transition-colors hover:bg-gh-critical/10 hover:text-gh-critical disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-critical/30"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
