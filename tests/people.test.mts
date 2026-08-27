import { test } from "node:test";
import assert from "node:assert/strict";
import { peopleFrom, MAX_PEOPLE, PERSON_SOURCE, PERSON_TARGET_SOURCE } from "../lib/pipeline/people.js";

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

test("a purchased contact is not mistaken for a hand-added person", () => {
  // find_source 'anymailfinder' is an address, not somebody typed in, so it
  // must not appear as a sixth name in its own right.
  const people = peopleFrom(company, [
    row({ id: "e", name: "Someone Else", email: "x@h.com", find_source: "anymailfinder", find_status: "found" }),
  ]);
  assert.deepEqual(people.map((p) => p.name), ["John Hansmann", "Steve Hansmann"]);
});
