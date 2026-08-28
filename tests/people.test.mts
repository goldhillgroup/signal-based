import { test } from "node:test";
import assert from "node:assert/strict";
import { peopleFrom, MAX_PEOPLE, PERSON_SOURCE, PERSON_TARGET_SOURCE, splitName, joinName } from "../lib/pipeline/people.js";

const company = { founder_name: "John Hansmann", founder_title: "Founder", next_gen_name: "Steve Hansmann", next_gen_title: "Owner" };
const row = (over: Record<string, unknown> = {}) => ({
  id: "c1", name: null, title: null, email: null, find_source: null, find_status: "not_attempted", ...over,
}) as never;

test("a company nobody has edited behaves exactly as before", () => {
  // The old rule was next_gen ?? founder. That must still be who gets bought
  // for, or every existing lead silently changes who it targets.
  const people = peopleFrom(company, []);
  assert.equal(people.length, 2);
  assert.equal(people.find((p) => p.isTarget)?.name, "Steve Hansmann");
});

test("a founder with no successor targets the founder", () => {
  const people = peopleFrom({ ...company, next_gen_name: null, next_gen_title: null }, []);
  assert.equal(people.find((p) => p.isTarget)?.name, "John Hansmann");
});

test("hand-added people join the list", () => {
  const people = peopleFrom(company, [
    row({ id: "a", name: "Dave Hansmann", find_source: PERSON_SOURCE }),
    row({ id: "b", name: "Julie Hansmann", find_source: PERSON_SOURCE }),
  ]);
  assert.deepEqual(people.map((p) => p.name), ["John Hansmann", "Steve Hansmann", "Dave Hansmann", "Julie Hansmann"]);
});

test("the ticked person wins over the next-generation default", () => {
  // Jonathan's case: the classifier named Steve, he wants Dave.
  const people = peopleFrom(company, [
    row({ id: "a", name: "Dave Hansmann", find_source: PERSON_TARGET_SOURCE }),
  ]);
  assert.equal(people.find((p) => p.isTarget)?.name, "Dave Hansmann");
  assert.equal(people.filter((p) => p.isTarget).length, 1, "exactly one target");
});

test("re-typing a name already in a crawler slot is the same person", () => {
  const people = peopleFrom(company, [
    row({ id: "a", name: "steve hansmann", find_source: PERSON_TARGET_SOURCE }),
  ]);
  assert.equal(people.length, 2, "not a third entry");
  assert.equal(people.find((p) => p.isTarget)?.name, "Steve Hansmann");
});

test("the list stops at five", () => {
  const extras = ["A", "B", "C", "D", "E"].map((n, i) => row({ id: `x${i}`, name: n, find_source: PERSON_SOURCE }));
  assert.equal(peopleFrom(company, extras).length, MAX_PEOPLE);
});

test("an address already on file shows against its person", () => {
  const people = peopleFrom(company, [
    row({ id: "e", name: "Steve Hansmann", email: "steve@h.com", find_source: "anymailfinder", find_status: "found" }),
  ]);
  assert.equal(people.find((p) => p.name === "Steve Hansmann")?.email, "steve@h.com");
});

test("a purchased address carrying a real name lists that person", () => {
  // This asserted the opposite until assignment proved it wrong. A bought row
  // only carries a name when we ASKED for that person or when the address was
  // handed to them by hand, and both make them somebody to show. The rule that
  // does the protecting is name_inferred, tested below.
  const people = peopleFrom(company, [
    row({ id: "e", name: "Someone Else", email: "x@h.com", find_source: "anymailfinder", find_status: "found" }),
  ]);
  assert.deepEqual(people.map((p) => p.name), ["John Hansmann", "Steve Hansmann", "Someone Else"]);
});

test("more than one person can be ticked", () => {
  // A builder with a founder and two sons is three people worth an address.
  // One radio button made that a choice between them.
  const people = peopleFrom(company, [
    row({ id: "a", name: "Dave Hansmann", find_source: PERSON_TARGET_SOURCE }),
    row({ id: "b", name: "Julie Hansmann", find_source: PERSON_TARGET_SOURCE }),
    row({ id: "c", name: "Pat Hansmann", find_source: PERSON_SOURCE }),
  ]);
  const ticked = people.filter((p) => p.isTarget).map((p) => p.name);
  assert.deepEqual(ticked, ["Dave Hansmann", "Julie Hansmann"]);
});

test("ticking nobody still falls back to the old single rule", () => {
  const people = peopleFrom(company, [row({ id: "a", name: "Dave Hansmann", find_source: PERSON_SOURCE })]);
  assert.deepEqual(people.filter((p) => p.isTarget).map((p) => p.name), ["Steve Hansmann"]);
});

test("a name splits into first and last", () => {
  assert.deepEqual(splitName("John Hansmann"), { first: "John", last: "Hansmann" });
  assert.deepEqual(splitName("Shari Cavallari"), { first: "Shari", last: "Cavallari" });
});

test("a generational suffix stays with the surname", () => {
  // "Bill Madey / Jr" would give somebody a surname of Jr, and that suffix is
  // exactly what tells a son from his father here.
  assert.deepEqual(splitName("Bill Madey Jr"), { first: "Bill", last: "Madey Jr" });
  assert.deepEqual(splitName("Francis Fahy Jr."), { first: "Francis", last: "Fahy Jr." });
});

test("a nickname survives the split", () => {
  assert.deepEqual(splitName('John "Hayden" Turner'), { first: 'John "Hayden"', last: "Turner" });
});

test("one word and nothing are handled", () => {
  assert.deepEqual(splitName("Diego"), { first: "Diego", last: "" });
  assert.deepEqual(splitName(null), { first: "", last: "" });
});

test("joining puts it back", () => {
  for (const n of ["John Hansmann", "Bill Madey Jr", 'John "Hayden" Turner', "Diego"]) {
    const { first, last } = splitName(n);
    assert.equal(joinName(first, last), n);
  }
});

test("an assigned vendor address becomes a person", () => {
  // Assigning mattscheff@ to Matt Scheff used to make him vanish: the row left
  // the loose list because it had a name, and never joined the people list
  // because its source was still the vendor's.
  const people = peopleFrom(company, [
    row({ id: "m", name: "Matt Scheff", email: "mattscheff@acme.com",
          find_source: "anymailfinder:also:unmatched", find_status: "found" }),
  ]);
  const matt = people.find((p) => p.name === "Matt Scheff");
  assert.ok(matt, "Matt Scheff should be listed");
  assert.equal(matt?.email, "mattscheff@acme.com");
});

test("an inferred name is not promoted to a person", () => {
  // The vendor's domain fallback reads a name off the mailbox: a lookup for
  // John Turner returning doug@ becomes "Doug", who is somebody else.
  const people = peopleFrom(company, [
    { id: "d", name: "Doug", name_inferred: true, title: null,
      email: "doug@acme.com", find_source: "anymailfinder", find_status: "found" } as never,
  ]);
  assert.equal(people.some((p) => p.name === "Doug"), false);
});

test("removing somebody who has an address keeps the address", () => {
  // The address was bought or scraped and is part of the record; the PERSON is
  // what was asked to go. Detaching leaves it in General inboxes, which is the
  // exact inverse of assigning one.
  const detached = peopleFrom(company, [
    row({ id: "m", name: null, email: "mattscheff@acme.com",
          find_source: "anymailfinder:also:unmatched", find_status: "found" }),
  ]);
  assert.equal(detached.some((p) => p.email === "mattscheff@acme.com"), false);
});
