"use client";

import { useEffect, useRef, useState } from "react";
import { PeopleEditor } from "./PeopleEditor";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Company, personalEmail, lookupCameBackEmpty, emailKindLabel, reachesAPerson } from "@/lib/company";
import { INDUSTRY_META } from "@/lib/signal-meta";
import {
  ConfidenceBadge,
  StatusBadge,
  FindStatusBadge,
  VerificationBadge,
} from "./badges";
import { XIcon, BuildingIcon } from "./icons";
import { formatRelativeDate } from "@/lib/stats";
import { explainFit } from "@/lib/fit-explanation";

// Which discovery channel surfaced this company — see lib/pipeline/apify.ts's
// discoverCandidates() and lib/pipeline/directory-discovery.ts.
// Step 04 of the stated method — his delivered proof shows this as a
// "Crews:" line on every card.
const OPERATING_MODEL_LABELS: Record<string, string> = {
  own_crews: "Direct crews",
  subcontract: "Subcontracts",
  mixed: "Mixed (crews + subs)",
  unknown: "Not stated on site",
};

const CHANNEL_LABELS: Record<string, string> = {
  // "directory" used to read "Industry directory / licensing board". Licensing
  // boards are their own channel now, so that trailing clause would attribute
  // two different sources to the same label.
  directory: "Industry / association directory",
  licensing: "Licensing board",
  web_search: "Web search (succession phrasing)",
  maps: "Google Maps (category listing)",
  // Not a crawler channel: the 72-company proof list was audited by a person
  // before any of this existed, and saying so is the point — it is the most
  // trustworthy provenance in the database, not the least.
  hand_audit: "Audited by hand",
};

export function CompanyDrawer({
  company,
  onClose,
}: {
  company: Company | null;
  onClose: () => void;
}) {
  const open = company !== null;
  // Which address was copied, not merely that one was: with two buttons a
  // boolean would tick both at once.
  const [copied, setCopied] = useState<string | null>(null);
  // EDITING WHO TO CALL. See app/api/company/[id]/people/route.ts for why the
  // people are editable and the evidence is not.
  // Null while we find out; false once the people table has answered. See
  // PeopleEditor for why a missing table must not surface as an error.
  const [peopleTableMissing, setPeopleTableMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // A flag that clears itself, rather than comparing Date.now() during render:
  // reading the clock while rendering makes the output depend on WHEN React
  // happens to re-render, which is exactly the kind of instability that shows
  // up once and never reproduces.
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({
    founder_name: "",
    founder_title: "",
    next_gen_name: "",
    next_gen_title: "",
  });
  const router = useRouter();

  // What the fields held when editing opened. Blur fires on every click away,
  // including one that changed nothing, and a PATCH per stray click is noise
  // in the log and a needless write.
  const original = useRef({ founder_name: "", founder_title: "", next_gen_name: "", next_gen_title: "" });
  function dirty() {
    const o = original.current;
    return (
      o.founder_name !== draft.founder_name ||
      o.founder_title !== draft.founder_title ||
      o.next_gen_name !== draft.next_gen_name ||
      o.next_gen_title !== draft.next_gen_title
    );
  }

  function startEdit() {
    if (!company) return;
    setError("");
    original.current = {
      founder_name: company.founderName ?? "",
      founder_title: company.founderTitle ?? "",
      next_gen_name: company.nextGenName ?? "",
      next_gen_title: company.nextGenTitle ?? "",
    };
    setDraft({
      founder_name: company.founderName ?? "",
      founder_title: company.founderTitle ?? "",
      next_gen_name: company.nextGenName ?? "",
      next_gen_title: company.nextGenTitle ?? "",
    });
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError("");
  }

  /**
   * Closing while a correction is half-typed.
   *
   * Auto-save fires on blur, and blur does NOT fire when the drawer unmounts
   * out from under the inputs -- clicking the backdrop, pressing the X, or
   * hitting Escape all destroy the fields without them ever losing focus in a
   * way React reports. So the exact gesture Jonathan described, edit a name
   * then click away to something else, was still the one that lost the edit.
   *
   * A "save or discard?" prompt is the obvious fix and the wrong one: the
   * answer is always save. He typed it on purpose. So it saves, and the close
   * waits for the write rather than racing it.
   */
  async function closeSafely() {
    if (editing && dirty() && !saving) {
      await savePeople({ keepOpen: true });
    }
    onClose();
  }

  async function savePeople({ keepOpen = false }: { keepOpen?: boolean } = {}) {
    if (!company) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/company/${company.id}/people`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save that.");
      original.current = { ...draft };
      setJustSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 4000);
      // An auto-save keeps the boxes open: focus left them, the intent to keep
      // editing did not necessarily go with it.
      if (!keepOpen) setEditing(false);
      // The drawer reads from a server-rendered list, so the row behind it is
      // stale the moment this succeeds.
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Escape closes the drawer without any element losing focus first, so it
  // needs the same save-then-close path as the backdrop and the X.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        void closeSafely();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // And a real navigation away -- a link, a reload, the back button -- cannot
  // be awaited, so this is the one case that genuinely has to ask. The browser
  // shows its own "leave site?" dialog; the wording is not ours to choose.
  useEffect(() => {
    if (!(editing && dirty())) return;
    function warn(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  });

  const fit = company ? explainFit(company) : null;
  const personal = company ? personalEmail(company) : null;

  async function copyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(email);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard API unavailable — no-op, email is still visible to copy manually
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-gh-navy-3/40 transition-opacity duration-[var(--gh-dur)] ease-[var(--gh-ease-out)] ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => void closeSafely()}
        aria-hidden
      />
      <aside
        className={`slide-panel fixed right-0 top-0 z-40 h-full w-full max-w-md transform overflow-y-auto bg-gh-surface shadow-2xl transition-transform duration-[var(--gh-dur-slow)] ease-[var(--gh-ease-out)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {company && (
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-gh-border p-5">
              <div>
                <span
                  className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                  style={{ background: INDUSTRY_META[company.industry].color }}
                >
                  {INDUSTRY_META[company.industry].label}
                </span>
                <h2 className="font-display text-xl font-semibold text-gh-ink">
                  {company.name}
                </h2>
                {/* Joined from what is actually present. City is null for every
                    channel except Maps, and the old template printed it raw —
                    so a web-search lead read "-, TN · Size not stated · not
                    stated employees", four placeholders in one line. */}
                <p className="mt-0.5 text-sm text-gh-ink-secondary">
                  {[
                    [company.city, company.state].filter((v) => v && v !== "-").join(", "),
                    company.revenueBand,
                    company.employeeBand && company.employeeBand !== "not stated"
                      ? `${company.employeeBand} employees`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void closeSafely()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gh-ink-muted transition-colors hover:bg-gh-surface-sunken hover:text-gh-ink"
                aria-label="Close"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3">
                <InfoTile label="Status">
                  <StatusBadge status={company.status} />
                </InfoTile>
                <InfoTile label="Confidence">
                  {company.confidence ? (
                    <ConfidenceBadge confidence={company.confidence} />
                  ) : company.status === "qualified" ? (
                    <span className="text-sm text-gh-ink-muted">No signal, fit-only match</span>
                  ) : (
                    <span className="text-sm text-gh-ink-muted">Not yet classified</span>
                  )}
                </InfoTile>
                {/* Free from the Places record, and only ever shown when it
                    is really there — an empty "Address" tile reads as a gap in
                    the data rather than as a channel that does not supply one
                    (web search and directories never do). */}
                {(company.phone || company.address) && (
                  <InfoTile label="Reach them directly">
                    {company.phone && (
                      <a
                        href={`tel:${company.phone.replace(/[^+\d]/g, "")}`}
                        className="block text-sm font-medium text-gh-sky hover:underline"
                      >
                        {company.phone}
                      </a>
                    )}
                    {company.address && (
                      <p className="mt-0.5 text-xs leading-snug text-gh-ink-secondary">
                        {company.address}
                      </p>
                    )}
                  </InfoTile>
                )}
                <InfoTile label="First seen">
                  <p className="text-sm font-medium text-gh-ink">
                    {formatRelativeDate(company.firstSeenAt)}
                  </p>
                </InfoTile>
                <InfoTile label="Last checked">
                  <p className="text-sm font-medium text-gh-ink">
                    {formatRelativeDate(company.lastCrawledAt)}
                  </p>
                </InfoTile>
              </div>

              {/* The "Rejection reason" block lived here. Removed with the rest
                  of the rejected surfaces: nothing in the dashboard shows a
                  rejected company any more, so this could only ever render for
                  a row that cannot be reached — dead UI that still had to be
                  read and maintained.
                  The reasons are NOT gone from the system. They are still
                  written to companies.rejection_reason and they are still what
                  recheck-policy.ts schedules the next look from, which is the
                  job they actually do. */}

              {/* Why an ACCEPTED company is here. A rejection always stated its
                  reason and a signal always showed its quote, but a company
                  that fit the ICP with no signal showed neither — it just
                  appeared. On a real folder that is most of the list, so most
                  of the list was unexplained. */}
              {/* A CUT COMPANY GETS THE OPPOSITE PANEL.
                  The drawer only ever opened on leads, so it had one story to
                  tell: why this one is worth calling. Rejected rows are now
                  clickable from the "Not a fit" tab, and they arrived here with
                  explainFit returning null — no reason, no verdict, just an
                  empty space where the explanation should be, under a status
                  chip reading "Not yet classified". The reason it was cut is
                  the ONLY thing this panel should say about it. */}
              {company.status === "rejected" && (
                <div className="rounded-lg border-l-2 border-gh-border-strong bg-gh-surface-sunken p-3.5">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gh-ink-muted">
                    Why this one was cut
                  </p>
                  <p className="text-sm font-medium text-gh-ink">
                    {company.rejectionReason ?? "Cut by one of your gates."}
                  </p>
                  <p className="mt-2.5 border-t border-gh-border pt-2.5 text-xs leading-relaxed text-gh-ink-secondary">
                    It is still on file. A future search reconsiders it when the
                    reason is one that can stop being true.
                  </p>
                </div>
              )}

              {fit && company.status !== "rejected" && (
                <div className="rounded-lg border-l-2 border-gh-sky bg-gh-surface-sunken p-3.5">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gh-ink-muted">
                    Why this one is here
                  </p>
                  <p className="text-sm font-medium text-gh-ink">{fit.headline}</p>
                  <ul className="mt-2 space-y-1.5">
                    {fit.points.map((p) => (
                      <li key={p} className="flex gap-2 text-xs leading-relaxed text-gh-ink-secondary">
                        <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gh-sky" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                  {fit.missing && (
                    <p className="mt-2.5 border-t border-gh-border pt-2.5 text-xs leading-relaxed text-gh-ink-secondary">
                      {fit.missing}
                    </p>
                  )}
                </div>
              )}

              {company.evidence && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gh-ink-muted">
                    Signal evidence
                  </p>
                  <blockquote
                    className="rounded-lg border-l-2 bg-gh-surface-sunken p-3.5 text-sm leading-relaxed text-gh-ink-secondary"
                    style={{ borderColor: INDUSTRY_META[company.industry].color }}
                  >
                    {company.evidence.quote}
                  </blockquote>
                  <p className="mt-2 text-xs text-gh-ink-muted">
                    Source: {company.evidence.sourceUrl.replace("https://", "")} ·{" "}
                    {company.evidence.pageType} page
                  </p>
                  {company.evidence.disproveNotes && (
                    <div className="mt-2 rounded-lg bg-gh-surface-sunken p-3">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
                        Disprove pass
                      </p>
                      <p className="text-xs leading-relaxed text-gh-ink-secondary">
                        {company.evidence.disproveNotes}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ALWAYS SHOWN, even when the crawler named nobody.
                  It used to render only if a name existed, so a company whose
                  successor Jonathan had found on LinkedIn had no row to put
                  him in and no way to reach one. The empty state is the case
                  that most needs the control. */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gh-ink-muted">
                    Leadership
                  </p>
                  <button
                    type="button"
                    hidden={!peopleTableMissing}
                    onClick={() => (editing ? savePeople() : startEdit())}
                    disabled={saving}
                    className="cursor-pointer rounded-lg border border-gh-border px-2.5 py-1 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/50 hover:text-gh-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
                  >
                    {saving
                      ? "Saving…"
                      : editing
                        ? "Done"
                        : justSaved
                          ? "Saved ✓"
                          : "Edit people"}
                  </button>
                </div>
                <div className="space-y-2.5 rounded-lg border border-gh-border p-3.5 text-sm">
                  {!peopleTableMissing && company && (
                    <PeopleEditor
                      companyId={company.id}
                      onUnavailable={() => setPeopleTableMissing(true)}
                    />
                  )}
                  {peopleTableMissing && editing ? (
                    // SAVES WHEN YOU CLICK AWAY, like renaming a folder.
                    //
                    // Requiring the button meant a correction typed and then
                    // abandoned was silently thrown away, which is the worst
                    // shape for a form: it looks finished and is not. Blur on
                    // the CONTAINER rather than each field, so tabbing between
                    // the four boxes is one edit and one write rather than
                    // four.
                    <div
                      onBlur={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                        if (!dirty()) return;
                        void savePeople({ keepOpen: true });
                      }}
                      className="space-y-2.5"
                    >
                      <PersonEdit
                        label="Founder"
                        name={draft.founder_name}
                        title={draft.founder_title}
                        onName={(v) => setDraft((d) => ({ ...d, founder_name: v }))}
                        onTitle={(v) => setDraft((d) => ({ ...d, founder_title: v }))}
                      />
                      <PersonEdit
                        label="Next generation"
                        name={draft.next_gen_name}
                        title={draft.next_gen_title}
                        onName={(v) => setDraft((d) => ({ ...d, next_gen_name: v }))}
                        onTitle={(v) => setDraft((d) => ({ ...d, next_gen_title: v }))}
                      />
                      {/* The consequence of the edit, said before it is made.
                          Find emails buys an address for the next generation
                          when there is one and the founder otherwise, so which
                          box a name goes in decides who gets paid for. */}
                      <p className="pt-1 text-[11px] leading-relaxed text-gh-ink-muted">
                        Find emails looks up the next generation when there is
                        one, and the founder otherwise. Leave a box empty to
                        clear it.
                      </p>
                      {error && <p className="text-[11px] text-gh-critical">{error}</p>}
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="cursor-pointer text-[11px] text-gh-ink-muted underline-offset-2 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : peopleTableMissing ? (
                    <>
                      {company.founderName ? (
                        // Labeled "Founder" only alongside a real next-gen pairing (a
                        // genuine succession story) — otherwise this is just whoever
                        // the page names as the decision-maker (owner/CEO/GM/etc, see
                        // openrouter.ts), so "Contact" reads accurately either way.
                        <Row
                          k={company.nextGenName ? "Founder" : "Contact"}
                          v={`${company.founderName}${company.founderTitle ? `, ${company.founderTitle}` : ""}`}
                        />
                      ) : (
                        <Row k="Founder" v="nobody named" muted />
                      )}
                      {company.nextGenName ? (
                        <Row k="Next generation" v={`${company.nextGenName}${company.nextGenTitle ? `, ${company.nextGenTitle}` : ""}`} />
                      ) : (
                        <Row k="Next generation" v="nobody named" muted />
                      )}
                    </>
                  ) : null}
                  {/* Facts about the company rather than judgements about who
                      runs it, so they stay put in both modes. */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-gh-ink-muted">Website</span>
                    <span className="inline-flex items-center gap-1 font-medium text-gh-ink-secondary">
                      <BuildingIcon className="h-3.5 w-3.5" />
                      {company.domain}
                    </span>
                  </div>
                  {company.operatingModel && (
                    <Row
                      k="Crews"
                      v={OPERATING_MODEL_LABELS[company.operatingModel] ?? company.operatingModel}
                    />
                  )}
                  {company.discoveryChannel && (
                    <Row k="Found via" v={CHANNEL_LABELS[company.discoveryChannel] ?? company.discoveryChannel} />
                  )}
                </div>
              </div>

              {(company.allContacts ?? []).length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gh-ink-muted">
                    Contact
                  </p>
                  <div className="space-y-3 rounded-lg border border-gh-border p-3.5">
                    {/* The panel now renders when EITHER address exists, so
                        the header describes whichever contact row is leading.
                        Prefer the personal one: its status is the one that
                        answers "can I write to this person". */}
                    {(() => {
                      const head = personal ?? company.contact ?? company.backupContact;
                      if (!head) return null;
                      return (
                        <>
                          <div className="flex items-center justify-between">
                            <FindStatusBadge status={head.findStatus} />
                            {head.findStatus === "found" && (
                              <VerificationBadge status={head.verificationStatus} />
                            )}
                          </div>
                          {head.name && (
                            <Row
                              k="Name"
                              v={`${head.name}${head.nameInferred ? " (inferred from email)" : ""}${
                                head.title ? `, ${head.title}` : ""
                              }`}
                            />
                          )}
                        </>
                      );
                    })()}
                    {/* EVERY ADDRESS, EACH SAYING WHAT IT IS.
                        This printed the best personal one and the best general
                        one, which is fine when a company has two and quietly
                        wrong when it has four: the other two simply were not
                        mentioned. Jonathan asked the question outright, "maybe
                        there are three emails, which one is which", and the
                        crawler already knew -- it classified each address when
                        it read the page and then kept the answer to itself. */}
                    {(company.allContacts ?? []).filter((c) => c.email).map((c) => (
                      <div key={c.email} className="flex items-start justify-between gap-3 text-sm">
                        <span className="shrink-0 text-gh-ink-muted">{emailKindLabel(c)}</span>
                        <button
                          type="button"
                          onClick={() => copyEmail(c.email!)}
                          className={`break-all text-right font-medium hover:underline ${
                            reachesAPerson(c) ? "text-gh-sky" : "text-gh-ink-secondary"
                          }`}
                        >
                          {copied === c.email ? "Copied ✓" : c.email}
                        </button>
                      </div>
                    ))}
                    {!personal?.email && (
                      <p className="text-xs text-gh-ink-muted">
                        {lookupCameBackEmpty(company)
                          ? "The lookup ran and found no personal address for this company."
                          : "No personal address on their site yet. Find personal emails will look one up."}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function InfoTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gh-border p-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gh-ink-muted">{k}</span>
      <span className={muted ? "text-gh-ink-muted" : "font-medium text-gh-ink"}>{v}</span>
    </div>
  );
}

/** A name and a title, side by side, so the pair reads as one person. */
function PersonEdit({
  label,
  name,
  title,
  onName,
  onTitle,
}: {
  label: string;
  name: string;
  title: string;
  onName: (v: string) => void;
  onTitle: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
        {label}
      </p>
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Name"
          maxLength={120}
          aria-label={`${label} name`}
          // 16px on mobile, or iOS zooms in on focus and will not zoom back.
          className="min-w-0 flex-[3] rounded-lg border border-gh-border bg-gh-surface-sunken px-2 py-1.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/25 sm:text-sm"
        />
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="Title"
          maxLength={120}
          aria-label={`${label} title`}
          className="min-w-0 flex-[2] rounded-lg border border-gh-border bg-gh-surface-sunken px-2 py-1.5 text-base text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/25 sm:text-sm"
        />
      </div>
    </div>
  );
}
