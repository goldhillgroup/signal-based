import { test } from "node:test";
import assert from "node:assert/strict";
import { companiesToCsv } from "../lib/csv-export.js";
import type { Company } from "../lib/company.js";

const base = {
  id: "1", searchId: "s1", domain: "acme.com", name: "Acme", industry: "landscaping",
  state: "CT", city: "Bristol", revenueBand: null, employeeBand: null,
  status: "qualified", confidence: "high", rejectionReason: null,
  founderName: "A", founderTitle: null, nextGenName: "B", nextGenTitle: null,
  sourceUrl: "https://acme.com/about", hasSignal: true, discoveryChannel: "web_search",
  operatingModel: null, firstSeenAt: "2026-01-01T00:00:00Z", lastCrawledAt: "2026-01-01T00:00:00Z",
  phone: null, address: null, evidence: null, contact: null, backupContact: null, allContacts: [],
} as unknown as Company;

test("a combined export carries the list name in the first column", () => {
  const csv = companiesToCsv([{ ...base, listName: "Florida landscaping" } as never]);
  const [header, row] = csv.split("\r\n");
  assert.equal(header.split(",")[0], "list");
  assert.equal(row.split(",")[0], "Florida landscaping");
});

test("a single-folder export has no list column at all", () => {
  // An empty first column on every row is a question the reader has to answer
  // for themselves, and the folder name is already on the page they came from.
  const csv = companiesToCsv([base]);
  assert.equal(csv.split("\r\n")[0].startsWith("list,"), false);
  assert.equal(csv.split("\r\n")[0].split(",")[0], "company");
});
