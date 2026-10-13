/**
 * "Signal Radar isn't consistently capturing co-owners, even when their contact
 * information is available."
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanOtherPeople, titleFor, MAX_PAGE_PEOPLE, PAGE_PERSON_SOURCE } from "../lib/pipeline/co-owners.js";

const known = ["John Turner", "Mark Turner"];

test("three brothers who own it together are all kept, beyond the founder and successor", () => {
  const out = cleanOtherPeople(
    [
      { name: "Paul Turner", title: "Co-owner", relationship: "brother of John" },
      { name: "Mary Turner", title: "Co-owner", relationship: "wife of John" },
      { name: "Dana Reyes", title: "Managing Partner", relationship: null },
    ],
    known
  );
  assert.deepEqual(out.map((p) => p.name), ["Paul Turner", "Mary Turner", "Dana Reyes"]);
  assert.equal(out[0].relationship, "brother of John");
});

test("the founder and successor are never listed a second time", () => {
  const out = cleanOtherPeople(
    [
      { name: "John Turner", title: "Owner" },
      { name: "john  turner", title: "Owner" },
      { name: "Mark Turner Jr.", title: "VP" }, // a DIFFERENT person than Mark Turner
    ],
    known
  );
  assert.deepEqual(out.map((p) => p.name), ["Mark Turner Jr."]);
});

test("only names a person could look up and ring", () => {
  const out = cleanOtherPeople(
    [
      { name: "Dave", title: "Co-owner" }, // a first name is not an identification
      { name: "Erik A", title: "Partner" }, // an initial is not a surname
      { name: "Sue Ellen Park", title: "Partner" },
    ],
    []
  );
  assert.deepEqual(out.map((p) => p.name), ["Sue Ellen Park"]);
});

test("staff are not leadership", () => {
  const out = cleanOtherPeople(
    [
      { name: "Carlos Mena", title: "Crew Leader" },
      { name: "Tina Wolfe", title: "Receptionist" },
      { name: "Ray Ostrander", title: "Estimator" },
      { name: "Lena Voss", title: "Vice President" },
    ],
    []
  );
  assert.deepEqual(out.map((p) => p.name), ["Lena Voss"]);
});

test("no title is fine when the page relates them to the family", () => {
  const out = cleanOtherPeople([{ name: "Paul Turner", title: null, relationship: "brother" }], known);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, null);
});

test("it is capped, because a long list is a staff directory", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `Person${i} Lastname${i}`, title: "Partner" }));
  assert.equal(cleanOtherPeople(many, []).length, MAX_PAGE_PEOPLE);
});

test("anything malformed is dropped, never repaired", () => {
  assert.deepEqual(cleanOtherPeople(null, []), []);
  assert.deepEqual(cleanOtherPeople("Paul Turner", []), []);
  assert.deepEqual(cleanOtherPeople([null, 3, "x", {}, { name: 5 }], []), []);
});

test("a sentence masquerading as a name is not a person", () => {
  const out = cleanOtherPeople([{ name: "founded the company in 1962", title: null }], []);
  assert.deepEqual(out, []);
});

test("an address matched to a co-owner takes THEIR title, not the successor's", () => {
  const roster = [
    { name: "Mark Turner", title: "President" },
    { name: "Paul Turner", title: "Co-owner" },
  ];
  assert.equal(titleFor("Paul Turner", roster), "Co-owner");
  assert.equal(titleFor("Mark Turner", roster), "President");
  assert.equal(titleFor("Nobody Here", roster), null);
  assert.equal(titleFor(null, roster), null);
});

test("the source tag is stable", () => {
  assert.equal(PAGE_PERSON_SOURCE, "page:person");
});
