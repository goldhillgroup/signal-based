import { settledContact, type Company } from "./company";
import { toLead, SIGNAL_TYPE_META } from "./lead-signal";
import { isSharedInbox } from "./pipeline/page-email";
import { personalEmail, generalEmail } from "./company";

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
//
// `verdict` IS COLUMN TWO, and it is not optional. The export receives whatever
// the folder holds, which since rejections became visible includes the
// companies the pipeline cut. There was no status column at all, and
// signal_type fell through to "Good fit, no successor yet" for a rejected row —
// so a 67-row download presented 39 companies Jonathan's own test had thrown
// out as leads worth calling, with no way to tell them apart in the sheet.
//
// Second column rather than last because a spreadsheet is sorted and filtered
// on its left-hand columns, and "is this a lead or not" outranks every other
// question you can ask of this file.
const COLUMNS: { header: string; get: (c: Company) => string }[] = [
  { header: "company", get: (c) => c.name },
  { header: "verdict", get: (c) => (c.status === "rejected" ? "NOT A FIT" : "lead") },
  { header: "not_a_fit_reason", get: (c) => (c.status === "rejected" ? (c.rejectionReason ?? "") : "") },
  { header: "signal_type", get: (c) => SIGNAL_TYPE_META[toLead(c).signalType].label },
  { header: "signal_detail", get: (c) => toLead(c).signalDetail ?? "" },
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
  { header: "phone", get: (c) => c.phone ?? "" },
  { header: "address", get: (c) => c.address ?? "" },
  { header: "contact_name", get: (c) => personalEmail(c)?.name ?? "" },
  // BOTH addresses, in the columns the screen uses. These were gated on a PAID
  // lookup, so a company printing office@ in its own footer exported two blank
  // cells while that address sat visible in the app -- the sheet Jonathan
  // works from disagreeing with the page he approved it on. Whether an address
  // was bought is not the question a sheet needs answered; who it reaches is,
  // and email_status below still says how sure we are.
  { header: "contact_email", get: (c) => personalEmail(c)?.email ?? "" },
  { header: "general_inbox", get: (c) => generalEmail(c)?.email ?? "" },
  {
    header: "email_status",
    get: (c) => {
      const personal = personalEmail(c);
      if (!personal) return generalEmail(c) ? "general_inbox_only" : "not_found";
      if (personal.findStatus !== "found") return "read_from_their_site";
      const v = personal.verificationStatus;
      return v === "not_attempted" ? "unverified" : v;
    },
  },
  {
    header: "contact_type",
    get: (c) => {
      const s = personalEmail(c);
      return s?.email ? (isSharedInbox(s.email) ? "shared_inbox" : "named_person") : "";
    },
  },
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

/**
 * The same table as TSV, for pasting straight into Google Sheets.
 *
 * A CSV download works — Sheets will import it — but importing is four steps
 * (download, Drive, File > Import, choose how to replace the sheet) and it
 * lands as a new file rather than in the sheet someone already has open with
 * their own notes and columns beside it.
 *
 * Tab-separated text on the clipboard skips all of that: click the cell, paste,
 * and Sheets splits it into columns natively. Same for Excel and Numbers. No
 * OAuth, no Google API, no new vendor, and nothing that needs access to
 * Jonathan's Google account — which matters, because the alternative is asking
 * a client to authorise a third-party app against his own Drive.
 *
 * TABS, so cells must not contain them. Newlines are the other separator, so
 * both are collapsed to spaces — a signal quote spanning two lines would
 * otherwise silently become two rows and shift every column after it.
 */
function tsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

function companiesToTsv(companies: Company[]): string {
  const header = COLUMNS.map((c) => tsvCell(c.header)).join("\t");
  const rows = companies.map((c) => COLUMNS.map((col) => tsvCell(col.get(c))).join("\t"));
  return [header, ...rows].join("\n");
}

/**
 * Returns false when the browser refuses the clipboard — Safari and Firefox
 * both do without a user gesture or outside a secure context. The caller shows
 * the CSV download instead rather than a button that silently does nothing.
 */
export async function copyCompaniesForSheets(companies: Company[]): Promise<boolean> {
  const tsv = companiesToTsv(companies);
  try {
    await navigator.clipboard.writeText(tsv);
    return true;
  } catch {
    // Fallback for browsers that block the async clipboard API: a hidden
    // textarea plus execCommand still works in every one of them.
    try {
      const ta = document.createElement("textarea");
      ta.value = tsv;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
