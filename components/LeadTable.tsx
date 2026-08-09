"use client";

import { Fragment } from "react";
import type { Company } from "@/lib/company";
import { settledContact } from "@/lib/company";
import { toLead, SIGNAL_TYPE_META, leadPeople } from "@/lib/lead-signal";
import { isSharedInbox } from "@/lib/pipeline/page-email";

/**
 * A spreadsheet, not a layout.
 *
 * The first version wrapped every cell, so "Hewitt Garden and Design Center"
 * became five stacked lines, rows ran ~180px tall, and a thirteen-lead folder
 * scrolled for pages. Each group also rendered its own separate table, so the
 * column headers repeated three times down the screen and nothing lined up
 * with anything above it. That is a layout that happens to use <table>, and it
 * fails at the one job a table has: comparing many rows at a glance.
 *
 * The rules that make it a sheet, all of which matter:
 *   - EVERY CELL IS ONE LINE, clipped rather than wrapped, so row height is
 *     constant and the eye can run down a column without re-finding it
 *   - the full value is on hover, so clipping costs nothing
 *   - ONE header for the whole table, not one per group
 *   - groups are separator rows INSIDE the same table, the way a spreadsheet
 *     shows sections, so every row stays in one grid
 *   - zebra striping, because tracking a row across nine columns without it is
 *     what makes wide tables tiring
 *   - 14px text and real row height. Dense is not the same as SMALL: the first
 *     pass went to 12px with 6px padding, which fixed the wrapping and made
 *     the result something you have to lean into to read. Google Sheets itself
 *     is ~14px
 *   - a sticky header, so the columns are still named after the first screen
 *
 * The card view still exists for reading one lead properly — the quote and the
 * reasoning are prose and prose needs width. This is for scanning.
 */

export interface LeadGroup {
  key: string;
  label: string;
  rows: Company[];
}

const COLS = 10;

/** Short enough for a column. Full wording lives in the drawer. */
const CREWS: Record<string, string> = {
  own_crews: "own",
  subcontract: "subs",
  mixed: "mixed",
  unknown: "-",
};

export function LeadTable({
  groups,
  showGroupRows,
  onOpen,
}: {
  groups: LeadGroup[];
  /** False when grouping is off — one flat sheet, no separator rows. */
  showGroupRows: boolean;
  onOpen: (c: Company) => void;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-gh-border">
      <table className="w-full min-w-[1180px] table-fixed border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gh-surface-sunken text-xs font-semibold uppercase tracking-wide text-gh-ink-secondary">
            <Th className="w-[15%]">Company</Th>
            <Th className="w-[4%]">State</Th>
            <Th className="w-[11%]">Signal</Th>
            <Th className="w-[9%]">Size</Th>
            <Th className="w-[7%]">Crews</Th>
            <Th className="w-[17%]">What the site says</Th>
            <Th className="w-[12%]">Who to reach</Th>
            <Th className="w-[13%]">Email</Th>
            <Th className="w-[10%]">Deliverable</Th>
            <Th className="w-[6%]">Source</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              {showGroupRows && (
                <tr>
                  <td
                    colSpan={COLS}
                    className="border-y border-gh-border bg-gh-surface-sunken px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gh-ink-secondary"
                  >
                    {g.label}
                    <span className="ml-1.5 font-normal text-gh-ink-muted">{g.rows.length}</span>
                  </td>
                </tr>
              )}
              {g.rows.map((c, i) => {
                const lead = toLead(c);
                const meta = SIGNAL_TYPE_META[lead.signalType];
                const { founder, nextGen } = leadPeople(c);
                const contact = settledContact(c);
                const who = nextGen ?? founder ?? null;
                return (
                  <tr
                    key={c.id}
                    onClick={() => onOpen(c)}
                    // Striped on the index WITHIN its group, so every section
                    // starts on the same shade instead of alternating by
                    // accident of what came before it.
                    className={`cursor-pointer border-b border-gh-border/60 last:border-0 hover:bg-gh-sky/[0.06] ${
                      i % 2 === 1 ? "bg-gh-surface-sunken/40" : ""
                    }`}
                  >
                    <Td title={c.name} className="font-medium text-gh-ink">
                      {c.name}
                    </Td>
                    <Td>{c.state && c.state !== "-" ? c.state : "-"}</Td>
                    <Td title={`${meta.label} — ${meta.blurb}`}>
                      <span
                        className="inline-block rounded px-2 py-0.5 text-xs font-semibold"
                        style={{ color: meta.color, background: meta.bg }}
                      >
                        {meta.short}
                      </span>
                      {c.confidence && c.confidence !== "verify" && (
                        <span className="ml-1.5 text-xs text-gh-ink-muted">
                          {c.confidence === "high" ? "high" : "med"}
                        </span>
                      )}
                    </Td>
                    {/* ATOMIC VALUES, one fact per column — which is what a
                        spreadsheet is. The prose "why this lead" column that
                        sat here truncated to the same seven words on every
                        row ("Names a decision-...") and repeated the person
                        already shown under Who to reach. Size and crews are
                        short, they differ row to row, and they are two of the
                        gates a lead had to pass, so they carry the same
                        meaning in a form a column can actually hold. */}
                    <Td title={c.revenueBand}>
                      {c.revenueBand && !/not stated/i.test(c.revenueBand) ? (
                        c.revenueBand.replace(/\s*\(est\.\)/, "")
                      ) : (
                        <Muted>not stated</Muted>
                      )}
                    </Td>
                    <Td title={CREWS[c.operatingModel ?? "unknown"] ?? ""}>
                      {CREWS[c.operatingModel ?? "unknown"] ?? <Muted>-</Muted>}
                    </Td>
                    <Td title={lead.signalDetail}>{lead.signalDetail}</Td>
                    <Td title={who ?? ""}>{who ?? <Muted>nobody named</Muted>}</Td>
                    <Td title={contact?.email ?? ""}>
                      {contact?.email ? (
                        <a
                          href={`mailto:${contact.email}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-gh-sky hover:underline"
                        >
                          {contact.email}
                        </a>
                      ) : (
                        <Muted>{c.contact?.email ? "after Enrich" : "-"}</Muted>
                      )}
                    </Td>
                    {/* Plain words, not a coloured pill. In a sheet this column
                        is read, not spotted, and nine columns of badges is
                        where the first version stopped looking like data. */}
                    <Td>
                      {contact?.email ? (
                        <span
                          className={
                            contact.verificationStatus === "valid"
                              ? "text-[#0b7a0b]"
                              : contact.verificationStatus === "invalid"
                                ? "text-gh-critical"
                                : "text-gh-ink-muted"
                          }
                        >
                          {contact.verificationStatus === "valid"
                            ? "deliverable"
                            : contact.verificationStatus === "invalid"
                              ? "bad address"
                              : "unconfirmed"}
                          {isSharedInbox(contact.email) ? ", shared" : ""}
                        </span>
                      ) : (
                        <Muted>-</Muted>
                      )}
                    </Td>
                    {/* WHERE IT CAME FROM. Every lead has a page it was read
                        off, and the whole product rests on that being checkable
                        — Jonathan intends to audit the list against the live
                        sites himself. A lead you cannot trace is a lead you
                        have to take on trust, which is what the three agencies
                        before us asked him to do. */}
                    <Td title={lead.sourceUrl ?? "no source recorded"}>
                      {lead.sourceUrl ? (
                        <a
                          href={lead.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-gh-sky hover:underline"
                        >
                          open
                        </a>
                      ) : (
                        <Muted>-</Muted>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
          {total === 0 && (
            <tr>
              <td colSpan={COLS} className="px-3 py-10 text-center text-sm text-gh-ink-muted">
                No leads match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`border-b border-gh-border px-3 py-2.5 font-semibold ${className}`}>{children}</th>
  );
}

/**
 * One line, clipped, full value on hover.
 *
 * `table-fixed` on the table plus a width on every header is what actually
 * makes truncation work — without it a cell grows to fit its content and
 * `truncate` never fires, which is exactly why the first version wrapped.
 */
function Td({
  children,
  title,
  className = "",
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <td title={title} className={`truncate px-3 py-2.5 text-gh-ink-secondary ${className}`}>
      {children}
    </td>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-gh-ink-muted">{children}</span>;
}
