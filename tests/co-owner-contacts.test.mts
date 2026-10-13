/**
 * "For many companies the primary owner's email is not available, but a co
 * owner's email is. Since those contacts are not being included, we are
 * potentially missing qualified, reachable prospects."
 *
 * Even when an address WAS on file for a co-owner, every list, card and export
 * read exactly one personal contact per company, and the Excel route did not
 * even rank them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { contactsForCompany, personalContacts, type Company, type ContactRow } from "../lib/company.js";
import { companiesToCsv } from "../lib/csv-export.js";

const row = (o: Partial<ContactRow>): ContactRow => ({
  name: null,
  name_inferred: false,
  title: null,
  email: null,
  find_status: "found",
  find_source: "anymailfinder",
  verification_status: "valid",
  ...o,
});

const JOHN = row({ name: "John Turner", title: "Owner", email: "john@turner.com" });
const PAUL = row({ name: "Paul Turner", title: "Co-owner", email: "paul@turner.com" });
const OFFICE = row({ email: "office@turner.com", find_source: "company-page:role", find_status: "not_attempted", verification_status: "not_attempted" });
const MARY_NAME_ONLY = row({ name: "Mary Turner", title: "Co-owner", email: null, find_source: "page:person", find_status: "not_attempted", verification_status: "not_attempted" });

test("a name-only co-owner row never displaces a real address", () => {
  // Rows arrive in database order; the bare name is FIRST.
  const { contact, allContacts } = contactsForCompany([MARY_NAME_ONLY, OFFICE, JOHN]);
  assert.equal(contact?.email, "john@turner.com");
  assert.deepEqual(allContacts.map((c) => c.email), ["john@turner.com", "office@turner.com"]);
});

test("a company with ONLY names still maps, with nothing to write to", () => {
  const { contact, allContacts } = contactsForCompany([MARY_NAME_ONLY]);
  assert.equal(contact?.email, null);
  assert.deepEqual(allContacts, []);
});

test("the shared inbox is kept alongside, not instead", () => {
  const { contact, backupContact } = contactsForCompany([OFFICE, JOHN]);
  assert.equal(contact?.email, "john@turner.com");
  assert.equal(backupContact?.email, "office@turner.com");
});

/** Splits one CSV line the way a spreadsheet does, honouring quoted commas. */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const company = (rows: ContactRow[]): Company =>
  ({
    id: "1", searchId: "s1", domain: "turner.com", name: "Turner Landscaping", industry: "landscaping",
    state: "CT", city: "Bristol", revenueBand: "Size not stated", employeeBand: "not stated",
    status: "qualified", confidence: "high", rejectionReason: null,
    founderName: "John Turner", founderTitle: "Owner", nextGenName: null, nextGenTitle: null,
    sourceUrl: "https://turner.com/about", hasSignal: false, discoveryChannel: "web_search",
    operatingModel: null, firstSeenAt: "2026-01-01T00:00:00Z", lastCrawledAt: "2026-01-01T00:00:00Z",
    phone: null, address: null, evidence: null,
    ...contactsForCompany(rows),
  }) as unknown as Company;

test("every personal address is available, not just the first", () => {
  const c = company([JOHN, PAUL, OFFICE]);
  assert.deepEqual(personalContacts(c).map((x) => x.email), ["john@turner.com", "paul@turner.com"]);
});

test("the same address is never listed twice", () => {
  const c = company([JOHN, row({ ...JOHN, find_source: "reused-known-domain" })]);
  assert.equal(personalContacts(c).length, 1);
});

test("the export carries the co-owner's address in its own columns", () => {
  const csv = companiesToCsv([company([JOHN, PAUL, OFFICE])]);
  const [head, line] = csv.split("\r\n");
  const cols = parseLine(head);
  const cells = parseLine(line);
  const at = (h: string) => cells[cols.indexOf(h)];
  assert.equal(at("contact_email"), "john@turner.com");
  assert.equal(at("contact_2_email"), "paul@turner.com");
  assert.equal(at("contact_2_name"), "Paul Turner");
  assert.equal(at("contact_2_title"), "Co-owner");
  assert.equal(at("general_inbox"), "office@turner.com");
});

test("a sheet where nobody has a second contact carries no empty columns for it", () => {
  const csv = companiesToCsv([company([JOHN, OFFICE])]);
  assert.ok(!/contact_2_/.test(csv.split("\r\n")[0]));
  assert.ok(!/contact_3_/.test(csv.split("\r\n")[0]));
});

test("a third owner gets a third set of columns", () => {
  const SAM = row({ name: "Sam Turner", title: "Partner", email: "sam@turner.com" });
  const csv = companiesToCsv([company([JOHN, PAUL, SAM])]);
  const [head, line] = csv.split("\r\n");
  const cols = parseLine(head);
  assert.equal(parseLine(line)[cols.indexOf("contact_3_email")], "sam@turner.com");
});

test("a co-owner whose only address is a name-only row exports no phantom email", () => {
  const csv = companiesToCsv([company([JOHN, MARY_NAME_ONLY])]);
  assert.ok(!/contact_2_/.test(csv.split("\r\n")[0]));
});
