import { test } from "node:test";
import assert from "node:assert/strict";
import { allEmailsFor, bestEmailFor } from "../lib/pipeline/page-email.js";
import { emailKindLabel, type Contact } from "../lib/company.js";

const PAGE = [
  "office@hansmanbuilders.com",
  "steve@hansmanbuilders.com",
  "hansmancrew@gmail.com",
  "webmaster@somebodyelse.com",
];

test("keeps every usable address, not only the winner", () => {
  const all = allEmailsFor(PAGE, "hansmanbuilders.com", ["Steve Hansman"]);
  const got = all.map((a) => a.email);
  assert.ok(got.includes("steve@hansmanbuilders.com"));
  assert.ok(got.includes("office@hansmanbuilders.com"));
  assert.ok(got.includes("hansmancrew@gmail.com"));
});

test("still drops an address on somebody else's corporate domain", () => {
  const all = allEmailsFor(PAGE, "hansmanbuilders.com", ["Steve Hansman"]);
  assert.ok(!all.some((a) => a.email === "webmaster@somebodyelse.com"));
});

test("the first one is what bestEmailFor would have picked alone", () => {
  const all = allEmailsFor(PAGE, "hansmanbuilders.com", ["Steve Hansman"]);
  const best = bestEmailFor(PAGE, "hansmanbuilders.com", ["Steve Hansman"]);
  assert.equal(all[0].email, best?.email);
});

test("no duplicates even when the page repeats an address", () => {
  const all = allEmailsFor(
    ["office@acme.com", "office@acme.com", "OFFICE@acme.com"],
    "acme.com",
    []
  );
  assert.equal(all.length, 1);
});

test("empty page yields nothing rather than throwing", () => {
  assert.deepEqual(allEmailsFor([], "acme.com", ["Nobody"]), []);
});

function c(findSource: string): Contact {
  return { name: null, nameInferred: false, title: null, email: "x@y.com",
    findStatus: "not_attempted", findSource, verificationStatus: "not_attempted" };
}

test("every kind gets a label a person can read", () => {
  assert.equal(emailKindLabel(c("company-page:role")), "General inbox");
  assert.equal(emailKindLabel(c("company-page:person_match")), "Personal, matches the name");
  assert.equal(emailKindLabel(c("company-page:free_mail")), "Free mail account");
  assert.equal(emailKindLabel(c("anymailfinder")), "Bought, named person");
});

test("an unlabelled source still says something true", () => {
  assert.equal(emailKindLabel(c("")), "On the page");
});
