import { settledContact, type Company } from "./company";
import { toLead, SIGNAL_TYPE_META } from "./lead-signal";

// The "sheet" — a plain CSV download, opens directly in Excel/Google Sheets/
// Numbers with no export API, no OAuth, no extra vendor. Simplest thing that
// actually gets Jonathan a spreadsheet in his hands.
//
// COLUMN ORDER IS THE POINT. It follows the delivered lead-list format —
// company, signal type, signal detail, why this lead, date, location, contact,
// status, score, source — so the first five columns answer "why am I calling
// this one" before the sheet scrolls sideways. The previous order led with
// Company / Website / Industry / State / City / Revenue band and pushed the
// signal quote to column twelve, so the one thing the list is FOR was off
// screen in Excel's default width.
//
// It is also the shape of the Phase 1 deliverable, near enough word for word:
// "the signal behind each name, the reason it surfaced now, and the contact to
// start with".
const COLUMNS: { header: string; get: (c: Company) => string }[] = [
  { header: "company", get: (c) => c.name },
  { header: "signal_type", get: (c) => SIGNAL_TYPE_META[toLead(c).signalType].label },
  { header: "signal_detail", get: (c) => toLead(c).signalDetail },
  {
    header: "why_this_lead",
    get: (c) => {
      const l = toLead(c);
      return l.missing ? `${l.whyThisLead} ${l.missing}` : l.whyThisLead;
    },
  },
  // Labelled "surfaced", not "signal_date". A page saying "now joined by his
  // two sons" carries no date of its own, and stamping it with the day we read
  // the page would present a crawl timestamp as an event date.
  { header: "surfaced_on", get: (c) => c.firstSeenAt.slice(0, 10) },
  { header: "location", get: (c) => toLead(c).location },
  { header: "founder", get: (c) => c.founderName ?? "" },
  { header: "founder_title", get: (c) => c.founderTitle ?? "" },
  { header: "next_gen", get: (c) => c.nextGenName ?? "" },
  { header: "next_gen_title", get: (c) => c.nextGenTitle ?? "" },
  { header: "contact_name", get: (c) => settledContact(c)?.name ?? "" },
  { header: "contact_email", get: (c) => settledContact(c)?.email ?? "" },
  {
    header: "email_status",
    get: (c) => {
      const settled = settledContact(c);
      if (!settled) return c.contact?.email ? "not_enriched_yet" : "not_found";
      const v = settled.verificationStatus;
      return v === "not_attempted" ? "unverified" : v;
    },
  },
  { header: "score", get: (c) => String(toLead(c).score) },
  { header: "score_reasons", get: (c) => toLead(c).factors.join("; ") },
  { header: "website", get: (c) => c.domain },
  { header: "industry", get: (c) => (c.industry === "landscaping" ? "Landscaping" : "Home Builder") },
  { header: "revenue_band", get: (c) => c.revenueBand },
  { header: "source_url", get: (c) => toLead(c).sourceUrl ?? "" },
];

function csvCell(value: string): string {
  // Quote every cell containing a comma, quote, or newline; escape internal
  // quotes by doubling them (RFC 4180) — company names/quotes/addresses
  // routinely contain commas ("Smith & Sons, Inc.") so this isn't optional.
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function companiesToCsv(companies: Company[]): string {
  const header = COLUMNS.map((c) => csvCell(c.header)).join(",");
  const rows = companies.map((c) => COLUMNS.map((col) => csvCell(col.get(c))).join(","));
  return [header, ...rows].join("\r\n");
}

export function downloadCompaniesCsv(companies: Company[], filename: string) {
  const csv = companiesToCsv(companies);
  // BOM so Excel (still the most likely destination) reads UTF-8 correctly
  // instead of mangling accented characters/em-dashes.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
