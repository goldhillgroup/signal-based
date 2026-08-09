"use client";

import type { Company } from "@/lib/company";
import { settledContact } from "@/lib/company";
import { toLead, SIGNAL_TYPE_META, leadPeople } from "@/lib/lead-signal";
import { isSharedInbox } from "@/lib/pipeline/page-email";
import { formatRelativeDate } from "@/lib/stats";
import { explainFit } from "@/lib/fit-explanation";
import { VerificationBadge } from "./badges";

/**
 * The same leads as rows, carrying what the delivered sample list carries.
 *
 * The first version of this had six columns — company, signal, who, email,
 * phone, score — and dropped the two that do the actual work: the signal
 * DETAIL and WHY THIS LEAD. Those are the fields someone reads before picking
 * up the phone; without them a row says a lead exists but not what to say, and
 * the table becomes a worse version of the card rather than a different view
 * of it.
 *
 * Full width is fine here. A table is the right shape for twelve fields and
 * the wrong shape for prose, which is why the CARD view still exists: this is
 * for scanning and comparing, that is for reading one lead properly. Long text
 * is clamped to two lines with the full value on hover rather than truncated
 * to nothing.
 *
 * Scrolls inside its own container, so a narrow screen never makes the PAGE
 * scroll sideways.
 */
export function LeadTable({
  rows,
  onOpen,
}: {
  rows: Company[];
  onOpen: (c: Company) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gh-border">
      <table className="w-full min-w-[1180px] border-collapse text-sm">
        <thead>
          <tr className="whitespace-nowrap border-b border-gh-border bg-gh-surface-sunken text-left text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
            <th className="px-3 py-2.5">Company</th>
            <th className="px-3 py-2.5">Signal</th>
            <th className="min-w-[16rem] px-3 py-2.5">What the site says</th>
            <th className="min-w-[15rem] px-3 py-2.5">Why this lead</th>
            <th className="px-3 py-2.5">Who to reach</th>
            <th className="px-3 py-2.5">Email</th>
            <th className="px-3 py-2.5">Phone</th>
            <th className="px-3 py-2.5">Found</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const lead = toLead(c);
            const meta = SIGNAL_TYPE_META[lead.signalType];
            const { founder, nextGen } = leadPeople(c);
            const contact = settledContact(c);
            const fit = explainFit(c);
            return (
              <tr
                key={c.id}
                onClick={() => onOpen(c)}
                className="cursor-pointer border-b border-gh-border align-top last:border-0 hover:bg-gh-surface-sunken"
              >
                <td className="px-3 py-3">
                  <p className="font-semibold leading-snug text-gh-ink">{c.name}</p>
                  <p className="mt-0.5 text-[11px] text-gh-ink-muted">{lead.location}</p>
                  {lead.sourceUrl && (
                    <a
                      href={lead.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 inline-block text-[11px] text-gh-ink-muted underline-offset-2 hover:text-gh-sky hover:underline"
                    >
                      source
                    </a>
                  )}
                </td>

                <td className="px-3 py-3">
                  <span
                    className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ color: meta.color, background: meta.bg }}
                  >
                    {meta.label}
                  </span>
                </td>

                {/* THE EVIDENCE, in the company's own words. Clamped rather than
                    truncated at a character count, so it always ends on a whole
                    word and the full quote is one hover away. */}
                <td className="px-3 py-3">
                  <p
                    className="line-clamp-2 text-xs leading-relaxed text-gh-ink-secondary"
                    title={lead.signalDetail}
                  >
                    {lead.signalDetail}
                  </p>
                </td>

                {/* THE QUALIFYING FACTS, not the headline.
                    This rendered lead.whyThisLead, which is a verdict — "Fits
                    every criterion you set. No succession signal on the page
                    yet." — and therefore reads identically on every fit-only
                    row. Seen in a screenshot, four rows carried the same
                    sentence, which is a column that costs width and adds
                    nothing. The POINTS underneath it are per-company: the
                    trade and town, the size read, whether it runs its own
                    crews, who is named. Those differ row to row, which is the
                    entire job of a column in a table you are scanning. */}
                <td className="px-3 py-3">
                  <ul className="space-y-0.5">
                    {(fit?.points ?? []).slice(0, 3).map((pt) => (
                      <li
                        key={pt}
                        className="line-clamp-1 text-[11px] leading-relaxed text-gh-ink-secondary"
                        title={pt}
                      >
                        {pt}
                      </li>
                    ))}
                  </ul>
                  {lead.missing && (
                    <p
                      className="line-clamp-1 mt-1 text-[11px] leading-snug text-gh-ink-muted"
                      title={lead.missing}
                    >
                      {lead.missing}
                    </p>
                  )}
                </td>

                <td className="px-3 py-3 text-xs text-gh-ink-secondary">
                  {nextGen ? (
                    <>
                      <span className="block font-medium text-gh-ink">{nextGen}</span>
                      {founder && (
                        <span className="mt-0.5 block text-[11px] text-gh-ink-muted">
                          founder: {founder}
                        </span>
                      )}
                    </>
                  ) : founder ? (
                    <span className="block">{founder}</span>
                  ) : (
                    <span className="text-gh-ink-muted">nobody named</span>
                  )}
                </td>

                <td className="px-3 py-3">
                  {contact?.email ? (
                    <div>
                      <a
                        href={`mailto:${contact.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block max-w-[13rem] truncate text-xs font-medium text-gh-sky hover:underline"
                        title={contact.email}
                      >
                        {contact.email}
                      </a>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <VerificationBadge status={contact.verificationStatus} />
                        {isSharedInbox(contact.email) && (
                          <span className="text-[10px] text-gh-ink-muted">shared inbox</span>
                        )}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-gh-ink-muted">
                      {c.contact?.email ? "after Enrich" : "-"}
                    </span>
                  )}
                </td>

                <td className="px-3 py-3 text-xs text-gh-ink-secondary">
                  {c.phone ? (
                    <a
                      href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                      onClick={(e) => e.stopPropagation()}
                      className="whitespace-nowrap hover:underline"
                    >
                      {c.phone}
                    </a>
                  ) : (
                    <span className="text-gh-ink-muted">-</span>
                  )}
                </td>

                {/* "Found", never a fabricated event date. A page saying "now
                    joined by his sons" carries no date of its own. */}
                <td className="whitespace-nowrap px-3 py-3 text-[11px] text-gh-ink-muted">
                  {formatRelativeDate(lead.surfacedAt)}
                </td>

              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-10 text-center text-sm text-gh-ink-muted">
                No leads match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
