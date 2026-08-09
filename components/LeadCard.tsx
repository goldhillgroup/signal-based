"use client";

import { settledContact, type Company } from "@/lib/company";
import { isSharedInbox } from "@/lib/pipeline/page-email";
import { toLead, SIGNAL_TYPE_META, leadPeople } from "@/lib/lead-signal";
import { formatRelativeDate } from "@/lib/stats";
import { VerificationBadge, ConfidenceBadge } from "./badges";
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
  picked = null,
  onTogglePick,
}: {
  company: Company;
  onOpen: () => void;
  /** null turns the checkbox off entirely. */
  picked?: boolean | null;
  onTogglePick?: () => void;
}) {
  const lead = toLead(company);
  const meta = SIGNAL_TYPE_META[lead.signalType];
  const { founder, nextGen } = leadPeople(company);
  // A contact only counts once the lookup step has actually run. A row still
  // at 'not_attempted' is a candidate parked free off the company's own page
  // during classification — real, but not yet checked for deliverability and
  // not yet chosen over what AnymailFinder might find. Showing it before
  // Enrich is pressed would put emails in the folder that the two-step flow
  // says are not there yet, and would leave the Enrich button apparently
  // doing nothing for those rows.
  const contact = settledContact(company);
  const parked = company.contact?.findStatus === "not_attempted" && !!company.contact.email;
  const rejected = company.status === "rejected";
  const selectable = picked !== null && typeof onTogglePick === "function";

  return (
    // A cut company is visually quieter than a lead — muted border, no hover
    // lift, a dashed edge. It is on screen because it is worth being able to
    // look at, not because it is worth calling, and the card should not argue
    // otherwise from across the room.
    <article
      className={`fade-up flex h-full flex-col rounded-xl border bg-gh-surface ${
        rejected
          ? "border-dashed border-gh-border-strong/60"
          : "lift border-gh-border hover:border-gh-sky/50"
      } ${picked ? "ring-2 ring-gh-sky/50" : ""}`}
    >
      <div className="flex-1 p-4 sm:p-5">
        {/* No flex row any more: it existed to push the score to the right,
            and with the score gone the header is a single column. */}
        <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {selectable && (
                <input
                  type="checkbox"
                  checked={!!picked}
                  onChange={onTogglePick}
                  aria-label={`Select ${company.name}`}
                  className="h-4 w-4 shrink-0 cursor-pointer accent-gh-navy"
                />
              )}
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ color: meta.color, background: meta.bg }}
              >
                {meta.label}
              </span>
              {/* HIGH vs MEDIUM, kept distinct. The signal chip says a pair was
                  found; this says how firmly. The demo Jonathan liked shows
                  both, and collapsing them loses the difference between "two
                  generations named together with explicit succession language"
                  and "one element implied rather than stated". */}
              {company.confidence && company.confidence !== "verify" && (
                <ConfidenceBadge confidence={company.confidence} />
              )}
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
          {rejected && company.rejectionReason && (
            // The reason in full, not a tooltip. The point of showing a cut
            // company at all is that the reason might be wrong, and a reason
            // you have to hover to read is one nobody checks.
            <p className="mt-2 rounded-lg bg-gh-surface-sunken px-2.5 py-1.5 text-[11px] leading-relaxed text-gh-ink-secondary">
              <span className="font-semibold text-gh-ink">Cut because: </span>
              {company.rejectionReason}
            </p>
          )}

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
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-gh-border px-4 py-2.5 sm:px-5">
        {contact?.email ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <a
              href={`mailto:${contact.email}`}
              className="truncate text-xs font-semibold text-gh-sky hover:underline"
            >
              {contact.email}
            </a>
            <VerificationBadge status={contact.verificationStatus} />
            {isSharedInbox(contact.email) && (
              <span className="rounded-full bg-gh-surface-sunken px-2 py-0.5 text-[10px] font-semibold text-gh-ink-muted">
                shared inbox
              </span>
            )}
            {contact.name && (
              <span className="text-[11px] text-gh-ink-muted">
                {contact.name}
                {contact.title ? `, ${contact.title}` : ""}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-gh-ink-muted">
            {company.contact?.findStatus === "not_found"
              ? "No email found for this one"
              : parked
                ? "Contact ready, press Enrich to reveal it"
                : "Not looked up yet"}
          </span>
        )}

        {company.phone && (
          <a
            href={`tel:${company.phone.replace(/[^+\d]/g, "")}`}
            className="shrink-0 text-xs font-semibold text-gh-ink-secondary hover:text-gh-ink hover:underline"
          >
            {company.phone}
          </a>
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
