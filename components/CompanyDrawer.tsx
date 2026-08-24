"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Company, personalEmail, generalEmail } from "@/lib/company";
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
  const fit = company ? explainFit(company) : null;
  const personal = company ? personalEmail(company) : null;
  const general = company ? generalEmail(company) : null;

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
        onClick={onClose}
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
                onClick={onClose}
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

              {(company.founderName || company.nextGenName) && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gh-ink-muted">
                    Leadership
                  </p>
                  <div className="space-y-2.5 rounded-lg border border-gh-border p-3.5 text-sm">
                    {company.founderName && (
                      // Labeled "Founder" only alongside a real next-gen pairing (a
                      // genuine succession story) — otherwise this is just whoever
                      // the page names as the decision-maker (owner/CEO/GM/etc, see
                      // openrouter.ts), so "Contact" reads accurately either way.
                      <Row
                        k={company.nextGenName ? "Founder" : "Contact"}
                        v={`${company.founderName}${company.founderTitle ? `, ${company.founderTitle}` : ""}`}
                      />
                    )}
                    {company.nextGenName && (
                      <Row k="Next generation" v={`${company.nextGenName}${company.nextGenTitle ? `, ${company.nextGenTitle}` : ""}`} />
                    )}
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
              )}

              {(company.contact || company.backupContact) && (
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
                    {/* LABELLED BY WHO IT REACHES, and both shown.
                        This panel used to print one address under the flat
                        heading "Email", so office@fatherandsonlandscape.com
                        looked like the way to reach Buddy Orth. It is the way
                        to reach whoever opens the office mail. Saying which is
                        which is the difference between a warm approach and one
                        that never arrives. */}
                    {personal?.email && (
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-gh-ink-muted">Personal</span>
                        <button
                          type="button"
                          onClick={() => copyEmail(personal.email!)}
                          className="font-medium text-gh-sky hover:underline"
                        >
                          {copied === personal.email ? "Copied ✓" : personal.email}
                        </button>
                      </div>
                    )}
                    {general?.email && (
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-gh-ink-muted">General inbox</span>
                        <button
                          type="button"
                          onClick={() => copyEmail(general.email!)}
                          className="font-medium text-gh-ink-secondary hover:underline"
                        >
                          {copied === general.email ? "Copied ✓" : general.email}
                        </button>
                      </div>
                    )}
                    {!personal?.email && (
                      <p className="text-xs text-gh-ink-muted">
                        {general?.email
                          ? "No personal address published on the site. Find emails will look one up."
                          : "No individually published email found at this domain."}
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gh-ink-muted">{k}</span>
      <span className="font-medium text-gh-ink">{v}</span>
    </div>
  );
}
