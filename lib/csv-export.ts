import { settledContact, type Company } from "./company";
import { toLead, SIGNAL_TYPE_META } from "./lead-signal";
import { isSharedInbox } from "./pipeline/page-email";
import { scoreLead, gradeSignal, starsFor, STAR_LABEL } from "./lead-score";
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
/**
 * A lead carrying the name of the list it came from.
 *
 * Only set by the combined export on Lead Lists. A per-folder download already
 * knows which folder it is, and would carry the same value on every row.
 */
export type Exportable = Company & { listName?: string };

export const COLUMNS: { header: string; get: (c: Exportable) => string }[] = [
  // FIRST, so a combined sheet sorts and groups by it without being rearranged.
  // Empty on a single-folder export, where the column is noise, and the header
  // is dropped in that case below.
  { header: "list", get: (c) => c.listName ?? "" },
  // THE BAND, NOT THE NUMBER, and that is a decision with evidence behind it.
  //
  // Measured on the real database: median 15 out of 100, 86% of 448 leads in
  // the bottom band. An earlier 1-10 score was pulled from this export for the
  // same reason, recorded in tests/lead.test.mts -- "30 of 33 leads scored 4
  // or below, so printing it told the client his own leads were failures".
  //
  // The number is real and still sorts the table in the app. What it is not is
  // something to print beside a company's name in a sheet Jonathan sends on,
  // because 15/100 reads as a verdict on the lead when it mostly means an
  // address has not been bought yet. The words say what to do instead.
  // 1-5, which is a judgement anybody can read, unlike the 0-100 sort key.
  { header: "score", get: (c) => String(starsFor(c)) },
  { header: "score_means", get: (c) => STAR_LABEL[starsFor(c)] },
  { header: "next_step", get: (c) => (c.status === "qualified" ? scoreLead(c).band : "") },
  // How good the SIGNAL is, which is a different axis from what the lead
  // needs. Both are wanted: one ranks the evidence, the other says what to do.
  { header: "signal_quality", get: (c) => (c.status === "qualified" ? gradeSignal(c).quality : "") },
  { header: "signal_quality_why", get: (c) => (c.status === "qualified" ? gradeSignal(c).why : "") },
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
  // LAST, AND ALWAYS EMPTY. Jonathan asked for somewhere to keep remarks. A
  // notes column in the database needs a migration this app cannot run from
  // here, and the sheet is where he is writing them anyway -- so the export
  // leaves him the column instead of making him insert one every time.
  { header: "remarks", get: () => "" },
];

/**
 * Which columns carry a verdict, so the styled copy can colour them.
 *
 * Kept as data rather than a switch inside the renderer: a new column that
 * needs colouring is a line here, not a branch in the HTML builder.
 */
const VERDICT_COLOUR: Record<string, string> = {
  lead: "#0b7a0b",
  "NOT A FIT": "#a3272a",
};

function csvCell(value: string): string {
  // Quote every cell containing a comma, quote, or newline; escape internal
  // quotes by doubling them (RFC 4180) — company names/quotes/addresses
  // routinely contain commas ("Smith & Sons, Inc.") so this isn't optional.
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * The "list" column is dropped when nothing fills it. A per-folder export
 * already knows which folder it is, and an empty first column on every row is
 * a question the reader has to answer for themselves.
 */
export function usedColumns(companies: Exportable[]) {
  return COLUMNS.filter(
    (c) => c.header !== "list" || companies.some((x) => (x.listName ?? "").length > 0)
  );
}

export function companiesToCsv(companies: Exportable[]): string {
  const used = usedColumns(companies);
  const header = used.map((c) => csvCell(c.header)).join(",");
  const rows = companies.map((c) => used.map((col) => csvCell(col.get(c))).join(","));
  return [header, ...rows].join("\r\n");
}

export function downloadCompaniesCsv(companies: Exportable[], filename: string) {
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
/**
 * The same rows as a formatted table.
 *
 * WHY HTML. Google Sheets and Excel both read a `text/html` clipboard flavour
 * and keep its formatting on paste -- bold headers, fills, colours, links --
 * where tab-separated text arrives as grey rows somebody then has to style by
 * hand every time. The plain-text flavour is written alongside, so anything
 * that cannot read HTML still gets the columns.
 *
 * Inline styles only. A clipboard fragment has no stylesheet to reach.
 */
function companiesToHtml(companies: Exportable[]): string {
  const used = usedColumns(companies);
  const th = (h: string) =>
    `<th style="background:#0b1220;color:#ffffff;font-family:Arial,sans-serif;` +
    `font-size:11px;font-weight:700;text-align:left;padding:6px 8px;` +
    `border:1px solid #26324a;white-space:nowrap">${escapeHtml(h.replace(/_/g, " "))}</th>`;

  const rows = companies.map((c, i) => {
    const stripe = i % 2 === 0 ? "#ffffff" : "#f5f7fa";
    const cells = used.map((col) => {
      const raw = col.get(c);
      const base =
        `font-family:Arial,sans-serif;font-size:11px;padding:5px 8px;` +
        `border:1px solid #dfe4ec;background:${stripe};vertical-align:top`;
      // The verdict is the column the eye goes to first, so it carries the
      // colour rather than the whole row: a red row reads as an error.
      const colour = VERDICT_COLOUR[raw];
      if (colour) {
        return `<td style="${base};color:${colour};font-weight:700">${escapeHtml(raw)}</td>`;
      }
      if (/^https?:\/\//.test(raw)) {
        return `<td style="${base}"><a href="${escapeHtml(raw)}" style="color:#0b5e85">${escapeHtml(raw)}</a></td>`;
      }
      if (raw.includes("@") && !raw.includes(" ")) {
        return `<td style="${base};color:#0b5e85">${escapeHtml(raw)}</td>`;
      }
      // The empty remarks column, given room so it is obviously for writing in.
      if (col.header === "remarks") {
        return `<td style="${base};min-width:220px;background:#fffdf3"></td>`;
      }
      return `<td style="${base}">${escapeHtml(raw)}</td>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  });

  return (
    `<table style="border-collapse:collapse">` +
    `<thead><tr>${used.map((c) => th(c.header)).join("")}</tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table>`
  );
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function copyCompaniesForSheets(companies: Exportable[]): Promise<boolean> {
  const tsv = companiesToTsv(companies);
  const html = companiesToHtml(companies);
  // BOTH FLAVOURS, HTML first. Sheets takes the richest one it understands and
  // falls back on its own; writing only text would throw the formatting away,
  // and writing only HTML would break every plain-text destination.
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([tsv], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // Fall through to plain text rather than failing the copy outright.
  }
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
