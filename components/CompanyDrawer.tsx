"use client";

import { useEffect, useState } from "react";
import { PeopleEditor } from "./PeopleEditor";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Company, personalEmail, lookupCameBackEmpty, emailKindLabel } from "@/lib/company";
import { INDUSTRY_META } from "@/lib/signal-meta";
import {
  ConfidenceBadge,
  StatusBadge,
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
  onDataChanged,
}: {
  company: Company | null;
  onClose: () => void;
  /**
   * Re-read the list behind the drawer.
   *
   * router.refresh() is the wrong tool on the folder page: it is a client
   * component holding its companies in state, so there is no server render to
   * invalidate and the call does nothing. Blacklisting a lead therefore left
   * it sitting on screen until the page was reloaded by hand.
   */
  onDataChanged?: () => void | Promise<void>;
}) {
  const open = company !== null;
  // Which address was copied, not merely that one was: with two buttons a
  // boolean would tick both at once.
  const [copied, setCopied] = useState<string | null>(null);
  const router = useRouter();
  // Unsaved work in the people editor. Closing the drawer would destroy it
  // without a word, which is the exact thing the explicit-save rewrite exists
  // to prevent, so the close is refused and says why.
  const [peopleDirty, setPeopleDirty] = useState(false);
  const [blockedClose, setBlockedClose] = useState(false);

  function closeUnlessEditing() {
    if (peopleDirty) {
      setBlockedClose(true);
      return;
    }
    onClose();
  }

  // Escape closes the drawer, and must go through the same guard as the
  // backdrop and the X. It was lost when the old editing state was stripped
  // out, so Escape did nothing at all for a while.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (peopleDirty) {
        setBlockedClose(true);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const [blacklisting, setBlacklisting] = useState(false);
  const [blacklistError, setBlacklistError] = useState("");

  async function setBlacklisted(action: "blacklist" | "restore") {
    if (!company) return;
    setBlacklisting(true);
    setBlacklistError("");
    try {
      const res = await fetch(`/api/company/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "That did not work.");
      // Re-read before closing, so the row leaves the tab it was on rather
      // than lingering until a manual reload.
      await onDataChanged?.();
      router.refresh();
      onClose();
    } catch (e) {
      setBlacklistError((e as Error).message);
    } finally {
      setBlacklisting(false);
    }
  }

  // No editing state here any more. Every row in PeopleEditor edits in place
  // and commits on blur, and saves itself on unmount, so the drawer does not
  // need to know whether a correction is in flight before it closes.

  const fit = company ? explainFit(company) : null;
  const personal = company ? personalEmail(company) : null;
  // Addresses matched to nobody. A row with a name is shown on that person's
  // line in the people list; these are what is left, and they are the front
  // desk rather than a lead.
  const unattached = (company?.allContacts ?? []).filter((c) => c.email && !c.name);

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
        onClick={closeUnlessEditing}
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
                onClick={closeUnlessEditing}
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
              {blockedClose && (
                <div className="rounded-lg border border-gh-warning/40 bg-gh-warning/10 px-3 py-2">
                  <p className="text-[11px] leading-relaxed text-gh-ink-secondary">
                    You have unsaved changes to the people on this lead. Press
                    Done editing to keep them, or Cancel to drop them.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setBlockedClose(false);
                      setPeopleDirty(false);
                      onClose();
                    }}
                    className="mt-1.5 cursor-pointer text-[11px] font-semibold text-gh-critical underline-offset-2 hover:underline"
                  >
                    Close anyway and lose them
                  </button>
                </div>
              )}

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
                    Contacts
                  </p>
                </div>
                <div className="space-y-2.5 rounded-lg border border-gh-border p-3.5 text-sm">
                  {company && (
                    <PeopleEditor
                      companyId={company.id}
                      onChanged={() => {
                        void onDataChanged?.();
                        router.refresh();
                      }}
                      onDirtyChange={setPeopleDirty}
                    />
                  )}

                  {/* ADDRESSES THAT BELONG TO NOBODY, under the people rather
                      than in a panel of their own.
                      
                      There were two sections, Leadership and Contact, and both
                      showed people AND emails -- the same person's name in
                      each, the same address in each, edited in one and not the
                      other. Daniel: "why is the leadership and then the contact
                      different, like totally different". They were never two
                      subjects. A person and how to reach them is one thing, and
                      what is left over is the front desk.
                      
                      Nobody attached means exactly name IS NULL: office@ off a
                      footer, billing@ from a domain sweep. Anything matched to
                      a human shows on that human's row above. */}
                  {unattached.length > 0 && (
                    <div className="mt-3 border-t border-gh-border pt-3">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gh-ink-muted">
                        General inboxes
                      </p>
                      <div className="space-y-1">
                        {unattached.map((k) => (
                          <div key={k.email} className="flex items-baseline justify-between gap-2">
                            <a
                              href={`mailto:${k.email}`}
                              className="min-w-0 flex-1 truncate text-[11px] text-gh-ink-secondary hover:underline"
                            >
                              {k.email}
                            </a>
                            <span className="shrink-0 text-[10px] text-gh-ink-muted">
                              {emailKindLabel(k)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!personal?.email && (
                    <p className="mt-2 text-[11px] leading-relaxed text-gh-ink-muted">
                      {lookupCameBackEmpty(company)
                        ? "The lookup ran and found no personal address for this company."
                        : "No personal address yet. Find personal emails will look one up, or type one in above if you have it."}
                    </p>
                  )}
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

              {/* BLACKLIST, at the foot of everything the lead has to say.
                  Deliberately last: it is the action you take having read the
                  quote and decided, not one to trip over on the way in. */}
              <div className="rounded-lg border border-gh-border p-3.5">
                {company.status === "rejected" ? (
                  <>
                    <p className="text-xs text-gh-ink-secondary">
                      Cut from your lists, and skipped by future searches.
                    </p>
                    <button
                      type="button"
                      disabled={blacklisting}
                      onClick={() => void setBlacklisted("restore")}
                      className="mt-2 cursor-pointer rounded-lg border border-gh-border px-3 py-1.5 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-sky/50 hover:text-gh-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
                    >
                      {blacklisting ? "Putting it back…" : "Put it back"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-gh-ink-secondary">
                      Not one you want? Blacklisting it takes it off your lists
                      and stops future searches finding it again.
                    </p>
                    <button
                      type="button"
                      disabled={blacklisting}
                      onClick={() => void setBlacklisted("blacklist")}
                      className="mt-2 cursor-pointer rounded-lg border border-gh-border px-3 py-1.5 text-[11px] font-semibold text-gh-ink-secondary transition-colors hover:border-gh-critical/50 hover:text-gh-critical disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-critical/30"
                    >
                      {blacklisting ? "Blacklisting…" : "Blacklist this company"}
                    </button>
                  </>
                )}
                {blacklistError && (
                  <p className="mt-1.5 text-[11px] text-gh-critical">{blacklistError}</p>
                )}
              </div>

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

