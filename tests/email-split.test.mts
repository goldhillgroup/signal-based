import { test } from "node:test";
import assert from "node:assert/strict";
import { personalEmail, generalEmail, reachesAPerson, lookupCameBackEmpty, emailKindLabel, type Company, type Contact } from "../lib/company.js";
import { localMatchesName } from "../lib/pipeline/page-email.js";

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

test("a bought address with an inferred name is not sold as a named person", () => {
  // The domain fallback: asked for John Turner, got doug@ and read "Doug" off
  // the handle. Real address, wrong person.
  const inferred: Contact = { name: "Doug", nameInferred: true, title: null,
    email: "doug@turnerandsonsllc.com", findStatus: "found",
    findSource: "anymailfinder", verificationStatus: "valid" };
  assert.equal(emailKindLabel(inferred), "Bought, company address");
  assert.equal(reachesAPerson(inferred), false);
});

test("a bought address for a person actually found still counts", () => {
  const real: Contact = { name: "Douglas Turner", nameInferred: false, title: null,
    email: "doug@turnerandsonsllc.com", findStatus: "found",
    findSource: "anymailfinder", verificationStatus: "valid" };
  assert.equal(emailKindLabel(real), "Bought, named person");
  assert.equal(reachesAPerson(real), true);
});

test("a mailbox carrying a generational suffix matches its person", () => {
  // Central Mechanical publishes billjr@ and its successor is Bill Madey Jr.
  // nameTokens drops "Jr" for being two letters, so the address was found,
  // sat in the results, and could not be attached to the obvious owner.
  assert.equal(localMatchesName("billjr", "Bill Madey Jr"), true);
  assert.equal(localMatchesName("bill.jr", "Bill Madey Jr"), true);
  assert.equal(localMatchesName("bmadeyjr", "Bill Madey Jr"), true);
});

test("the suffix rule does not match a different person", () => {
  assert.equal(localMatchesName("dmadey", "Bill Madey Jr"), false);
  assert.equal(localMatchesName("markjr", "Bill Madey Jr"), false);
  assert.equal(localMatchesName("office", "Bill Madey Jr"), false);
});

test("names without a suffix are unaffected", () => {
  assert.equal(localMatchesName("skip", "Skip Orth"), true);
  assert.equal(localMatchesName("buddy", "Buddy Orth"), true);
  assert.equal(localMatchesName("accounting", "Skip Orth"), false);
});

test("a swept address does not claim to be on the company's page", () => {
  // billing@ came back with a paid lookup for somebody else at the same
  // company. Calling that "On the page" says the wrong thing about where it
  // came from, and "on the page" is checkable in a way the other is not.
  const swept: Contact = { name: null, nameInferred: false, title: null,
    email: "billing@acme.com", findStatus: "found",
    findSource: "anymailfinder:also:unmatched", verificationStatus: "not_attempted" };
  assert.equal(emailKindLabel(swept), "Bought, nobody matched");
});

test("an address typed in by hand says so", () => {
  const typed: Contact = { name: "Larry Estes", nameInferred: false, title: null,
    email: "larry@estesdm.com", findStatus: "found",
    findSource: "user:typed", verificationStatus: "not_attempted" };
  assert.equal(emailKindLabel(typed), "Added by you");
});
