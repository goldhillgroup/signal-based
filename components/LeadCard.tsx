"use client";

import type { Company } from "@/lib/company";
import { toLead, SIGNAL_TYPE_META, leadPeople } from "@/lib/lead-signal";
import { formatRelativeDate } from "@/lib/stats";
import { VerificationBadge } from "./badges";
import { BuildingIcon, UsersIcon } from "./icons";

/**
 * One lead, carrying what the sample lead-list format carries: signal type,
 * the signal itself, why it is worth a call, when it surfaced, where, who to
 * contact, a score, and the source.
 *
 * A card rather than a wide table row. The same twelve fields work as columns
 * in a spreadsheet, where a row is one line and the eye scans down a column;
 * on screen they would need horizontal scrolling to read a single lead, and
 * the two fields that decide whether he calls — the quote and the reason —
 * are prose that cannot survive a 15rem column. The CSV export keeps the
 * column shape for the spreadsheet, which is where columns belong.
 */
export function LeadCard({
  company,
  onOpen,
}: {
  company: Company;
  onOpen: () => void;
}) {
  const lead = toLead(company);
  const meta = SIGNAL_TYPE_META[lead.signalType];
  const { founder, nextGen } = leadPeople(company);
  const contact = company.contact;

  return (
    <article className="fade-up rounded-xl border border-gh-border bg-gh-surface transition-colors duration-200 hover:border-gh-sky/50">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ color: meta.color, background: meta.bg }}
              >
                {meta.label}
              </span>
              <span className="text-[11px] text-gh-ink-muted">{lead.location}</span>
              <span aria-hidden className="text-gh-border">
                ·
              </span>
              {/* "Surfaced", never a fabricated event date. A page saying "now
                  joined by his sons" carries no date of its own. */}
              <span className="text-[11px] text-gh-ink-muted">
                surfaced {formatRelativeDate(lead.surfacedAt)}
              </span>
            </div>

            <button
              type="button"
              onClick={onOpen}
              className="mt-1.5 block cursor-pointer text-left font-display text-base font-semibold leading-snug text-gh-ink hover:text-gh-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
            >
              {company.name}
            </button>
            <p className="mt-0.5 text-[11px] text-gh-ink-muted">{company.domain}</p>
          </div>

          {/* The score, with its reasons on hover rather than as a bare number
              nobody can argue with. */}
          <div
            className="shrink-0 text-right"
            title={lead.factors.join("\n")}
          >
            <span className="tabular block font-display text-2xl font-semibold leading-none text-gh-navy">
              {lead.score}
            </span>
            <span className="block text-[10px] text-gh-ink-muted">of 10</span>
          </div>
        </div>

        {/* THE SIGNAL — the company's own words where there are any. */}
        <blockquote
          className="mt-3 rounded-lg border-l-2 bg-gh-surface-sunken p-3 text-xs leading-relaxed text-gh-ink-secondary"
          style={{ borderColor: meta.color }}
        >
          {lead.signalDetail}
        </blockquote>

        {/* WHY THIS LEAD, and what is missing when something is. */}
        <p className="mt-2.5 text-xs leading-relaxed text-gh-ink">{lead.whyThisLead}</p>
        {lead.missing && (
          <p className="mt-1 text-[11px] leading-relaxed text-gh-ink-muted">{lead.missing}</p>
        )}

        {(founder || nextGen) && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
            {founder && (
              <span className="flex items-center gap-1.5 text-gh-ink-secondary">
                <BuildingIcon className="h-3.5 w-3.5 shrink-0 text-gh-ink-muted" />
                {/* "Founder" only alongside a real next-gen pairing — otherwise
                    this is just whoever the page names as decision-maker. */}
                <span className="font-medium text-gh-ink-muted">
                  {nextGen ? "Founder" : "Contact"}:
                </span>
                {founder}
              </span>
            )}
            {nextGen && (
              <span className="flex items-center gap-1.5 text-gh-ink-secondary">
                <UsersIcon className="h-3.5 w-3.5 shrink-0 text-gh-ink-muted" />
                <span className="font-medium text-gh-ink-muted">Next gen:</span>
                {nextGen}
              </span>
            )}
          </div>
        )}
      </div>

      {/* THE CONTACT TO START WITH — on the card, not one click away. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gh-border px-4 py-2.5 sm:px-5">
        {contact?.email ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <a
              href={`mailto:${contact.email}`}
              className="truncate text-xs font-semibold text-gh-sky hover:underline"
            >
              {contact.email}
            </a>
            <VerificationBadge status={contact.verificationStatus} />
            {contact.name && (
              <span className="text-[11px] text-gh-ink-muted">
                {contact.name}
                {contact.title ? `, ${contact.title}` : ""}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-gh-ink-muted">
            {contact ? "No email found for this one" : "Not looked up yet"}
          </span>
        )}

        {lead.sourceUrl && (
          <a
            href={lead.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[11px] font-medium text-gh-ink-muted underline-offset-2 hover:text-gh-ink hover:underline"
          >
            Source page
          </a>
        )}
      </div>
    </article>
  );
}
