import { Company } from "./mock-companies";

// The "sheet" — a plain CSV download, opens directly in Excel/Google Sheets/
// Numbers with no export API, no OAuth, no extra vendor. Simplest thing that
// actually gets Jonathan a spreadsheet in his hands.
const COLUMNS: { header: string; get: (c: Company) => string }[] = [
  { header: "Company", get: (c) => c.name },
  { header: "Website", get: (c) => c.domain },
  { header: "Industry", get: (c) => (c.industry === "landscaping" ? "Landscaping" : "Home Builder") },
  { header: "State", get: (c) => c.state },
  { header: "City", get: (c) => c.city },
  { header: "Revenue band", get: (c) => c.revenueBand },
  {
    header: "Status",
    get: (c) => {
      if (c.status === "rejected") return "Rejected";
      if (c.status === "pending") return "Scanning";
      if (!c.confidence) return "Fit only — no signal found";
      return c.confidence === "verify" ? "Qualified — verify" : `Qualified — ${c.confidence}`;
    },
  },
  { header: "Founder name", get: (c) => c.founderName ?? "" },
  { header: "Founder title", get: (c) => c.founderTitle ?? "" },
  { header: "Next-gen name", get: (c) => c.nextGenName ?? "" },
  { header: "Next-gen title", get: (c) => c.nextGenTitle ?? "" },
  { header: "Signal quote", get: (c) => c.evidence?.quote ?? "" },
  { header: "Signal source", get: (c) => c.evidence?.sourceUrl ?? "" },
  { header: "Contact name", get: (c) => c.contact?.name ?? "" },
  { header: "Contact email", get: (c) => c.contact?.email ?? "" },
  {
    header: "Email deliverability",
    get: (c) => {
      if (!c.contact || c.contact.findStatus !== "found") return "Not found";
      const v = c.contact.verificationStatus;
      return v === "not_attempted" ? "Not verified" : v.charAt(0).toUpperCase() + v.slice(1);
    },
  },
  { header: "Rejection reason", get: (c) => c.rejectionReason ?? "" },
  { header: "Source URL", get: (c) => c.sourceUrl ?? "" },
  { header: "First seen", get: (c) => c.firstSeenAt },
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
