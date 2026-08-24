import { test } from "node:test";
import assert from "node:assert/strict";
import { personalEmail, generalEmail, reachesAPerson, lookupCameBackEmpty, type Company, type Contact } from "../lib/company.js";

function contact(email: string, findSource: string, findStatus: Contact["findStatus"] = "not_attempted"): Contact {
  return { name: null, nameInferred: false, title: null, email, findStatus, findSource, verificationStatus: "not_attempted" };
}
function company(c: Contact | null, backup: Contact | null = null): Company {
  return { contact: c, backupContact: backup } as unknown as Company;
}

test("a scraped address matching the founder's name reaches a person", () => {
  assert.equal(reachesAPerson(contact("manny@oceansidelandscapinginc.com", "company-page:person_match")), true);
});

test("a name-shaped mailbox on their own domain reaches a person", () => {
  assert.equal(reachesAPerson(contact("jpmcgrath@seasonseast.com", "company-page:person")), true);
});

test("a role inbox does not, however much it looks like a contact", () => {
  // The exact address from Father and Son Pest and Lawn Solutions.
  assert.equal(reachesAPerson(contact("office@fatherandsonlandscape.com", "company-page:role")), false);
});

test("a company catch-all on a free provider does not reach a person", () => {
  // ATZ Irrigation. Nobody's name, so looking up Tristan Zullo is still worth
  // doing -- this is the case isSharedInbox alone got wrong.
  assert.equal(reachesAPerson(contact("atz5232@aol.com", "company-page:free_mail")), false);
});

test("a bought address counts as personal: a named person is what was asked for", () => {
  assert.equal(reachesAPerson(contact("bhopper@hopperengineering.com", "anymailfinder", "found")), true);
});

test("but a lookup that came back with info@ is still a front desk", () => {
  assert.equal(reachesAPerson(contact("info@example.com", "anymailfinder", "found")), false);
});

test("the two columns split one company's addresses, never duplicating one", () => {
  const c = company(
    contact("buddy@fatherandsonlandscape.com", "company-page:person"),
    contact("office@fatherandsonlandscape.com", "company-page:role")
  );
  assert.equal(personalEmail(c)?.email, "buddy@fatherandsonlandscape.com");
  assert.equal(generalEmail(c)?.email, "office@fatherandsonlandscape.com");
});

test("a company with only a front desk shows it there, and nothing in Email", () => {
  const c = company(contact("office@fatherandsonlandscape.com", "company-page:role"));
  assert.equal(personalEmail(c), null);
  assert.equal(generalEmail(c)?.email, "office@fatherandsonlandscape.com");
});

test("no address at all is empty in both, not 'after Enrich' in either", () => {
  const c = company(null);
  assert.equal(personalEmail(c), null);
  assert.equal(generalEmail(c), null);
});

test("an unlabelled legacy row is judged on its mailbox name", () => {
  // Rows written before find_source was carried through. Falling back to the
  // local part is worse than knowing, and better than dropping them.
  assert.equal(reachesAPerson(contact("will@example.com", "", "found")), true);
  assert.equal(reachesAPerson(contact("info@example.com", "", "found")), false);
});

test("an untouched company says the lookup has not run", () => {
  assert.equal(lookupCameBackEmpty(company(null)), false);
});

test("a company whose lookup came back empty says so", () => {
  const empty: Contact = { name: null, nameInferred: false, title: null, email: null,
    findStatus: "not_found", findSource: "anymailfinder", verificationStatus: "not_attempted" };
  assert.equal(lookupCameBackEmpty(company(empty)), true);
});

test("having a general inbox is NOT evidence the lookup ran", () => {
  // The old rule keyed the Email column on this and drew a line the reader
  // could not act on: both kinds of row enrich identically.
  const c = company(contact("office@acme.com", "company-page:role"));
  assert.equal(lookupCameBackEmpty(c), false);
});
