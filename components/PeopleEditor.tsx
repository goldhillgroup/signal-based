"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, PencilIcon, TrashIcon } from "./icons";
import { splitName, joinName } from "@/lib/pipeline/people";

/**
 * Who is at this company, and which of them a paid lookup is for.
 *
 * WHY IT EXISTS. Two name slots, founder and next generation, and Jonathan
 * opened Hansmann Construction to find four people worth listing: he corrected
 * the founder, then Dave (another son) and Julie turned up as well. He had to
 * delete one to make room for another. Enrichment bought an address for one
 * person, and which one was decided by whichever the classifier wrote first,
 * so a wrong name did not merely look wrong -- it spent five cents on the
 * wrong person and filed the result as though it were right.
 *
 * NOTHING SAVES UNTIL DONE EDITING, which reverses how this worked for a day.
 * Rows used to commit the moment focus left them, on the argument that a
 * correction typed and then abandoned should not be thrown away. Daniel asked
 * twice for the opposite and was right to: a panel that writes on every blur
 * gives you no way to change your mind, and half-typed text becomes a saved
 * fact while you are still looking at it. The draft is yours until you say
 * otherwise, and leaving with unsaved work asks rather than guessing.
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

/** A person plus whatever the draft has done to them. */
interface Draft extends Person {
  key: string;
  removed: boolean;
  isNew: boolean;
}

const ROLE_LABEL: Record<Person["origin"], string> = {
  founder: "Founder",
  next_gen: "Next generation",
  user: "Added by you",
};

function toDrafts(people: Person[]): Draft[] {
  return people.map((p, i) => ({
    ...p,
    key: p.id ?? `${p.origin}-${i}`,
    removed: false,
    isNew: false,
  }));
}

export function PeopleEditor({
  companyId,
  onChanged,
  onDirtyChange,
}: {
  companyId: string;
  onChanged?: () => void;
  /** Lets the drawer refuse to close on unsaved work. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loose, setLoose] = useState<{ id: string; email: string; source: string | null }[]>([]);
  // Which loose address is being handed to somebody, and to whom.
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignName, setAssignName] = useState("");
  const [max, setMax] = useState(5);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draftFirst, setDraftFirst] = useState("");
  const [draftLast, setDraftLast] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/company/${companyId}/people`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setPeople(json?.people ?? []);
        setLoose(json?.unattached ?? []);
        if (typeof json?.max === "number") setMax(json.max);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const baseline = people ?? [];
  const dirty =
    editing &&
    (drafts.some((d) => d.removed || d.isNew) ||
      drafts.some((d) => {
        const was = baseline.find((p) => (p.id ?? "") === (d.id ?? "") && p.origin === d.origin);
        if (!was) return true;
        return (
          d.name.trim() !== was.name.trim() ||
          (d.title ?? "").trim() !== (was.title ?? "").trim() ||
          (d.email ?? "").trim() !== (was.email ?? "").trim() ||
          d.isTarget !== was.isTarget
        );
      }));

  // The drawer needs to know, so a click on the backdrop cannot throw the
  // draft away without asking first.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current !== dirty) {
      dirtyRef.current = dirty;
      onDirtyChange?.(dirty);
    }
  });

  /**
   * Hand a loose address to somebody. Immediate rather than drafted: it moves
   * an address that already exists onto a person, so there is nothing to
   * mistype and nothing to lose by it taking effect.
   */
  async function assign(contactId: string, name: string, title: string | null) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/company/${companyId}/people`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assign: { contact_id: contactId, name, title } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "That did not work.");
      setPeople(json.people ?? []);
      setLoose(json.unattached ?? []);
      if (editing) setDrafts(toDrafts(json.people ?? []));
      setAssigning(null);
      setAssignName("");
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openEditor() {
    setDrafts(toDrafts(people ?? []));
    setError("");
    setEditing(true);
  }

  function discard() {
    setDrafts([]);
    setEditing(false);
    setAdding(false);
    setConfirmLeave(false);
    setError("");
    onDirtyChange?.(false);
  }

  function tryClose() {
    if (dirty) {
      setConfirmLeave(true);
      return;
    }
    discard();
  }

  /**
   * Everything the draft changed, in one go.
   *
   * Removals first, so taking somebody out and adding a fifth in the same
   * sitting does not trip the limit on a person already on their way out.
   */
  async function saveAll() {
    setSaving(true);
    setError("");
    const call = async (method: "POST" | "PATCH" | "DELETE", body: unknown) => {
      const res = await fetch(`/api/company/${companyId}/people`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "That did not work.");
      return json;
    };

    try {
      for (const d of drafts.filter((x) => x.removed && !x.isNew)) {
        if (d.origin === "user" && d.id) await call("DELETE", { contact_id: d.id });
        else await call("PATCH", { [`${d.origin === "founder" ? "founder" : "next_gen"}_name`]: "" });
      }

      for (const d of drafts.filter((x) => x.isNew && !x.removed)) {
        await call("POST", { name: d.name, title: d.title });
        if (d.isTarget) {
          await call("PATCH", { target: { name: d.name, title: d.title, selected: true } });
        }
        if ((d.email ?? "").trim()) {
          await call("PATCH", {
            person_name: d.name,
            person_title: d.title,
            email: (d.email ?? "").trim(),
          });
        }
      }

      for (const d of drafts.filter((x) => !x.removed && !x.isNew)) {
        const was = baseline.find((p) => (p.id ?? "") === (d.id ?? "") && p.origin === d.origin);
        if (!was) continue;
        const renamed =
          d.name.trim() !== was.name.trim() || (d.title ?? "").trim() !== (was.title ?? "").trim();
        if (renamed) {
          if (d.origin === "user" && d.id) {
            await call("PATCH", { contact_id: d.id, name: d.name, title: d.title });
          } else {
            const prefix = d.origin === "founder" ? "founder" : "next_gen";
            await call("PATCH", { [`${prefix}_name`]: d.name, [`${prefix}_title`]: d.title ?? "" });
          }
        }
        if (d.isTarget !== was.isTarget) {
          await call("PATCH", { target: { name: d.name, title: d.title, selected: d.isTarget } });
        }
        if ((d.email ?? "").trim() !== (was.email ?? "").trim()) {
          await call("PATCH", {
            person_name: d.name,
            person_title: d.title,
            email: (d.email ?? "").trim(),
          });
        }
      }

      const fresh = await fetch(`/api/company/${companyId}/people`).then((r) => r.json());
      setPeople(fresh?.people ?? []);
      setLoose(fresh?.unattached ?? []);
      setDrafts([]);
      setEditing(false);
      setAdding(false);
      setConfirmLeave(false);
      onDirtyChange?.(false);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (people === null) {
    return <p className="text-xs text-gh-ink-muted">Reading the people…</p>;
  }

  // ── Read mode ──────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          {people.length === 0 && (
            <p className="text-xs text-gh-ink-muted">Nobody is named on this one.</p>
          )}
          {people.map((p) => (
            <div
              key={`${p.id ?? p.origin}-${p.name}`}
              className="flex items-baseline justify-between gap-2"
            >
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium text-gh-ink">{p.name}</span>
                <span className="ml-1.5 text-[11px] text-gh-ink-muted">
                  {p.title ?? ROLE_LABEL[p.origin]}
                </span>
                {p.email && (
                  <span className="block truncate text-[11px] text-gh-sky">{p.email}</span>
                )}
              </span>
              {p.isTarget && (
                <span className="shrink-0 rounded-full bg-gh-sky/10 px-2 py-0.5 text-[10px] font-semibold text-gh-navy">
                  getting an email
                </span>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={openEditor}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-gh-border px-2.5 py-1.5 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/50 hover:text-gh-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          Edit people
        </button>
      </div>
      <LooseEmails
        loose={loose}
        people={people}
        busy={saving}
        assigning={assigning}
        assignName={assignName}
        setAssigning={setAssigning}
        setAssignName={setAssignName}
        onAssign={assign}
      />
      {error && <p className="mt-1.5 text-[11px] text-gh-critical">{error}</p>}
      </>
    );
  }

  const live = drafts.filter((d) => !d.removed);
  const full = live.length >= max;

  // ── Edit mode ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-2.5">
      <p className="text-[11px] leading-relaxed text-gh-ink-muted">
        Up to {max} people, and you can type in an address you found yourself.
        Everyone marked{" "}
        <span className="font-semibold text-gh-ink">Getting an email</span> is
        looked up when you press Find personal emails, and each is charged
        separately. Nothing is saved until you press Done editing.
      </p>

      {live.map((d) => (
        <PersonRow
          key={d.key}
          draft={d}
          busy={saving}
          onChange={(patch) =>
            setDrafts((prev) => prev.map((x) => (x.key === d.key ? { ...x, ...patch } : x)))
          }
          onRemove={() =>
            setDrafts((prev) =>
              d.isNew
                ? prev.filter((x) => x.key !== d.key)
                : prev.map((x) => (x.key === d.key ? { ...x, removed: true } : x))
            )
          }
        />
      ))}

      {adding ? (
        <div className="rounded-lg border border-gh-sky/40 bg-gh-surface-sunken p-2.5">
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={draftFirst}
              onChange={(e) => setDraftFirst(e.target.value)}
              placeholder="First name"
              maxLength={120}
              aria-label="New person first name"
              className="min-w-0 flex-[2] rounded-lg border border-gh-border bg-gh-surface px-2 py-1.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
            />
            <input
              value={draftLast}
              onChange={(e) => setDraftLast(e.target.value)}
              placeholder="Last name"
              maxLength={120}
              aria-label="New person last name"
              className="min-w-0 flex-[2] rounded-lg border border-gh-border bg-gh-surface px-2 py-1.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
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
          {/* Same three fields as a row that already exists, because adding
              somebody you found and correcting somebody the crawler found are
              the same job. Jonathan arrives with a name AND an address, from
              LinkedIn and then the company's own site; making him add the
              person, save, and come back for the address is a second trip for
              no reason. */}
          <input
            value={draftEmail}
            onChange={(e) => setDraftEmail(e.target.value)}
            placeholder="Email, if you found one"
            maxLength={200}
            inputMode="email"
            aria-label="New person email"
            className="mt-1.5 w-full rounded-lg border border-gh-border bg-gh-surface px-2 py-1.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={joinName(draftFirst, draftLast).length === 0}
              onClick={() => {
                setDrafts((prev) => [
                  ...prev,
                  {
                    key: `new-${prev.length}-${joinName(draftFirst, draftLast)}`,
                    id: null,
                    name: joinName(draftFirst, draftLast),
                    title: draftTitle.trim() || null,
                    origin: "user",
                    isTarget: false,
                    email: draftEmail.trim() || null,
                    removed: false,
                    isNew: true,
                  },
                ]);
                setDraftFirst("");
                setDraftLast("");
                setDraftTitle("");
                setAdding(false);
              }}
              className="cursor-pointer rounded-lg bg-gh-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraftFirst("");
                setDraftLast("");
                setDraftTitle("");
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
          disabled={full || saving}
          onClick={() => setAdding(true)}
          title={full ? `${max} people is the limit on one company.` : undefined}
          className="cursor-pointer rounded-lg border border-dashed border-gh-border px-3 py-1.5 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/50 hover:text-gh-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          {full ? `${live.length} of ${max}, that is the limit` : "Add a person"}
        </button>
      )}

      <LooseEmails
        loose={loose}
        people={live}
        busy={saving}
        assigning={assigning}
        assignName={assignName}
        setAssigning={setAssigning}
        setAssignName={setAssignName}
        onAssign={assign}
      />

      {error && <p className="text-[11px] text-gh-critical">{error}</p>}

      {confirmLeave ? (
        <div className="rounded-lg border border-gh-warning/40 bg-gh-warning/10 p-2.5">
          <p className="text-[11px] leading-relaxed text-gh-ink-secondary">
            You have changes that are not saved. Save them?
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveAll()}
              className="cursor-pointer rounded-lg bg-gh-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={discard}
              className="cursor-pointer rounded-lg border border-gh-border px-3 py-1.5 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-critical/50 hover:text-gh-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-critical/30"
            >
              Discard them
            </button>
            <button
              type="button"
              onClick={() => setConfirmLeave(false)}
              className="cursor-pointer text-[11px] text-gh-ink-muted underline-offset-2 hover:underline"
            >
              Keep editing
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveAll()}
            className="cursor-pointer rounded-lg bg-gh-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            {saving ? "Saving…" : "Done editing"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={tryClose}
            className="cursor-pointer text-[11px] text-gh-ink-muted underline-offset-2 hover:underline"
          >
            Cancel
          </button>
          {dirty && (
            <span className="text-[10px] font-semibold text-gh-warning">unsaved changes</span>
          )}
        </div>
      )}
    </div>
  );
}

/** One row of the draft. Edits the draft only; nothing reaches the server. */
function PersonRow({
  draft,
  busy,
  onChange,
  onRemove,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 transition-colors ${
        draft.isTarget ? "border-gh-sky/50 bg-gh-sky/[0.04]" : "border-gh-border"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* A TOGGLE, NOT A RADIO. Enrichment can buy for each person now, so a
            builder with a founder and two sons is three ticks rather than a
            choice between them. */}
        <button
          type="button"
          onClick={() => onChange({ isTarget: !draft.isTarget })}
          disabled={busy}
          aria-pressed={draft.isTarget}
          title={
            draft.isTarget
              ? `${draft.name} will be looked up. Click to leave them out.`
              : `Also look up an email for ${draft.name}`
          }
          className={`mt-0.5 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 ${
            draft.isTarget
              ? "bg-gh-navy text-white hover:bg-gh-navy-2"
              : "border border-gh-border text-gh-ink-muted hover:border-gh-navy/40 hover:text-gh-ink"
          }`}
        >
          {draft.isTarget && <CheckIcon className="h-3 w-3" />}
          {draft.isTarget ? "Getting an email" : "Also get this one"}
        </button>

        <div className="min-w-0 flex-1">
          {/* FIRST AND LAST, not one box. Correcting a surname in a single
              field means retyping the forename with it, and a stray space is
              invisible. Stored as one string still -- the split is for the
              hands, not the database. */}
          <div className="flex gap-1.5">
            <input
              value={splitName(draft.name).first}
              onChange={(e) => onChange({ name: joinName(e.target.value, splitName(draft.name).last) })}
              placeholder="First name"
              maxLength={120}
              aria-label={`${draft.name} first name`}
              // 16px on mobile, or iOS zooms in on focus and will not zoom back.
              className="min-w-0 flex-[2] rounded border border-gh-border bg-gh-surface-sunken px-1.5 py-1 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
            />
            <input
              value={splitName(draft.name).last}
              onChange={(e) => onChange({ name: joinName(splitName(draft.name).first, e.target.value) })}
              placeholder="Last name"
              maxLength={120}
              aria-label={`${draft.name} last name`}
              className="min-w-0 flex-[2] rounded border border-gh-border bg-gh-surface-sunken px-1.5 py-1 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
            />
            <input
              value={draft.title ?? ""}
              onChange={(e) => onChange({ title: e.target.value || null })}
              placeholder="Title"
              maxLength={120}
              aria-label={`${draft.name} title`}
              className="min-w-0 flex-[2] rounded border border-gh-border bg-gh-surface-sunken px-1.5 py-1 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
            />
          </div>
          {/* AN ADDRESS HE FOUND HIMSELF. Jonathan went to Estes' LinkedIn,
              then their website, and came back with addresses the crawler had
              not found and the vendor did not sell. There was nowhere to put
              them, so the work was lost when he closed the tab. */}
          <input
            value={draft.email ?? ""}
            onChange={(e) => onChange({ email: e.target.value || null })}
            placeholder="Email, if you found one"
            maxLength={200}
            inputMode="email"
            aria-label={`${draft.name} email`}
            className="mt-1.5 w-full rounded border border-gh-border bg-gh-surface-sunken px-1.5 py-1 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
          />
          <p className="mt-1 text-[10px] text-gh-ink-muted">{ROLE_LABEL[draft.origin]}</p>
        </div>

        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove ${draft.name} from this list`}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold text-gh-ink-muted transition-colors hover:bg-gh-critical/10 hover:text-gh-critical disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-critical/30"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          Remove
        </button>
      </div>
    </div>
  );
}

/**
 * The addresses nobody owns, and a way to give one to somebody.
 *
 * Jonathan's ask: a sweep at Father & Son returned mattscheff@ with nobody
 * attached, and that is plainly a person the crawler never named. Adding "Matt
 * Scheff" and then retyping his address is two jobs for one fact.
 *
 * Existing people are offered as buttons because that is the common case -- an
 * address the matcher could not spell its way to, belonging to somebody
 * already on the list -- and a free field covers the rest.
 */
function LooseEmails({
  loose,
  people,
  busy,
  assigning,
  assignName,
  setAssigning,
  setAssignName,
  onAssign,
}: {
  loose: { id: string; email: string; source: string | null }[];
  people: { name: string; title: string | null; email: string | null }[];
  busy: boolean;
  assigning: string | null;
  assignName: string;
  setAssigning: (v: string | null) => void;
  setAssignName: (v: string) => void;
  onAssign: (contactId: string, name: string, title: string | null) => void | Promise<void>;
}) {
  if (loose.length === 0) return null;
  const takers = people.filter((p) => !p.email);

  return (
    <div className="mt-3 border-t border-gh-border pt-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gh-ink-muted">
        General inboxes
      </p>
      <div className="space-y-1.5">
        {loose.map((k) => (
          <div key={k.id}>
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={`mailto:${k.email}`}
                className="min-w-0 flex-1 truncate text-[11px] text-gh-ink-secondary hover:underline"
              >
                {k.email}
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAssigning(assigning === k.id ? null : k.id);
                  setAssignName("");
                }}
                className="shrink-0 cursor-pointer text-[10px] font-semibold text-gh-ink-muted underline-offset-2 transition-colors hover:text-gh-ink hover:underline disabled:opacity-40"
              >
                {assigning === k.id ? "Cancel" : "Whose is this?"}
              </button>
            </div>

            {assigning === k.id && (
              <div className="mt-1.5 rounded-lg border border-gh-sky/40 bg-gh-surface-sunken p-2">
                {takers.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {takers.map((t) => (
                      <button
                        key={t.name}
                        type="button"
                        disabled={busy}
                        onClick={() => void onAssign(k.id, t.name, t.title)}
                        className="cursor-pointer rounded-full border border-gh-border px-2 py-0.5 text-[10px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-navy/40 hover:text-gh-ink disabled:opacity-40"
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={assignName}
                    onChange={(e) => setAssignName(e.target.value)}
                    placeholder="Or a name not listed"
                    maxLength={120}
                    aria-label={`Who does ${k.email} belong to`}
                    className="min-w-0 flex-1 rounded border border-gh-border bg-gh-surface px-1.5 py-1 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none sm:text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy || assignName.trim().length === 0}
                    onClick={() => void onAssign(k.id, assignName.trim(), null)}
                    className="cursor-pointer rounded bg-gh-navy px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-40"
                  >
                    Assign
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
