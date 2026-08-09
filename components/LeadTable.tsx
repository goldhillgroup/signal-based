"use client";

import type { Company } from "@/lib/company";
import { settledContact } from "@/lib/company";
import { toLead, SIGNAL_TYPE_META, leadPeople } from "@/lib/lead-signal";
import { isSharedInbox } from "@/lib/pipeline/page-email";
import { VerificationBadge } from "./badges";

/**
 * The same leads as rows.
 *
 * Cards win for reading one lead — the quote and the reasoning are prose and
 * need the width. Rows win for comparing many: scanning a column of scores, or
 * checking at a glance which companies still have no email, is work the card
 * layout makes slow because every field sits in a different place on screen.
 *
 * Both views, one dataset, switched by a control. Neither is "the" view; they
 * answer different questions.
 *
 * Horizontally scrollable inside its own container so a narrow screen never
 * makes the PAGE scroll sideways.
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
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-gh-border bg-gh-surface-sunken text-left text-[11px] font-semibold uppercase tracking-wide text-gh-ink-muted">
            <th className="px-3 py-2.5">Company</th>
            <th className="px-3 py-2.5">Signal</th>
            <th className="px-3 py-2.5">Who</th>
            <th className="px-3 py-2.5">Email</th>
            <th className="px-3 py-2.5">Phone</th>
            <th className="px-3 py-2.5 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const lead = toLead(c);
            const meta = SIGNAL_TYPE_META[lead.signalType];
            const { founder, nextGen } = leadPeople(c);
            const contact = settledContact(c);
            return (
              <tr
                key={c.id}
                onClick={() => onOpen(c)}
                className="cursor-pointer border-b border-gh-border last:border-0 hover:bg-gh-surface-sunken"
              >
                <td className="px-3 py-2.5">
                  <p className="font-semibold text-gh-ink">{c.name}</p>
                  <p className="text-[11px] text-gh-ink-muted">{lead.location}</p>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ color: meta.color, background: meta.bg }}
                  >
                    {meta.label}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-gh-ink-secondary">
                  {nextGen ?? founder ?? <span className="text-gh-ink-muted">nobody named</span>}
                </td>
                <td className="px-3 py-2.5">
                  {contact?.email ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <a
                        href={`mailto:${contact.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="max-w-[13rem] truncate text-xs font-medium text-gh-sky hover:underline"
                      >
                        {contact.email}
                      </a>
                      <VerificationBadge status={contact.verificationStatus} />
                      {isSharedInbox(contact.email) && (
                        <span className="text-[10px] text-gh-ink-muted">shared</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] text-gh-ink-muted">
                      {c.contact?.email ? "after Enrich" : "-"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-gh-ink-secondary">
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
                <td className="tabular px-3 py-2.5 text-right font-display text-sm font-semibold text-gh-navy">
                  {lead.score}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-10 text-center text-sm text-gh-ink-muted">
                No leads match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
