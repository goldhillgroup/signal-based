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

// What the real classifier returned, verbatim, for two realistic pages on
// 2026-10-13. The second is the one that taught the rule: it was told to leave
// staff out and listed a dispatcher, a crew leader and an operations manager.
test("a real answer: the siblings are kept, the founder and president are not repeated", () => {
  const raw = [
    { name: "Mark Hendricks", title: "Vice President of Operations", relationship: "son of Walt Hendricks, brother of Dana and Luke" },
    { name: "Luke Hendricks", title: "Co-owner and Director of Design", relationship: "son of Walt Hendricks, brother of Dana and Mark" },
  ];
  const out = cleanOtherPeople(raw, ["Walt Hendricks", "Dana Hendricks-Cole"]);
  assert.deepEqual(out.map((p) => p.name), ["Mark Hendricks", "Luke Hendricks"]);
});

test("a real answer: the wife who co-owns is kept, and NONE of the staff are, operations manager included", () => {
  const raw = [
    { name: "Patricia Lindqvist", title: "Co-owner and Controller", relationship: "wife of Gary, co-owner" },
    { name: "Rob Dillard", title: "Operations Manager", relationship: null },
    { name: "Jenna Pruitt", title: "Dispatcher", relationship: null },
    { name: "Mike Alvarado", title: "Crew Leader (Mowing)", relationship: null },
  ];
  const out = cleanOtherPeople(raw, ["Gary Lindqvist"]);
  assert.deepEqual(out.map((p) => p.name), ["Patricia Lindqvist"]);
});

test("managers of a department are not owners, however senior the page makes them sound", () => {
  const out = cleanOtherPeople(
    [
      { name: "Nina Brandt", title: "Project Manager" },
      { name: "Oscar Vail", title: "Operations Manager" },
      { name: "Pam Teller", title: "Account Executive" },
      { name: "Quinn Ames", title: "Superintendent" },
      { name: "Rita Cho", title: "Controller" },
    ],
    []
  );
  assert.deepEqual(out, []);
});

test("executives and owners are kept whatever the wording", () => {
  const out = cleanOtherPeople(
    [
      { name: "Al Green", title: "General Manager" },
      { name: "Bea Stone", title: "Managing Partner" },
      { name: "Cy Reed", title: "Principal" },
      { name: "Di Fox", title: "Chairwoman" },
      { name: "Ed Lane", title: "Director of Operations" },
      { name: "Flo Park", title: "CEO" },
    ],
    []
  );
  assert.equal(out.length, 4); // capped
  assert.deepEqual(out.map((p) => p.name), ["Al Green", "Bea Stone", "Cy Reed", "Di Fox"]);
});

test("a relative in an ordinary job stays, because the family is the point", () => {
  const out = cleanOtherPeople([{ name: "Tony Rossi", title: "Crew Leader", relationship: "nephew of Joe, joined in 2022" }], []);
  assert.deepEqual(out.map((p) => p.name), ["Tony Rossi"]);
});

test("a name with neither a title nor a stated tie is not enough to go on", () => {
  assert.deepEqual(cleanOtherPeople([{ name: "Sam Whitfield", title: null, relationship: null }], []), []);
  assert.deepEqual(cleanOtherPeople([{ name: "Sam Whitfield", title: null, relationship: "not related" }], []), []);
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

test("people the page speaks of as gone are not contacts", () => {
  const out = cleanOtherPeople(
    [
      { name: "Ralph Mann Sr.", title: "Founder", relationship: "the late founder, father of Ralph Jr. and George" },
      { name: "Hank Doyle", title: "Co-founder (deceased)", relationship: null },
      { name: "George Mann", title: "Vice President", relationship: "brother of Ralph Jr." },
    ],
    []
  );
  assert.deepEqual(out.map((p) => p.name), ["George Mann"]);
});

test("a founder who has only stepped back is still a person", () => {
  // "Founder and Trusted Advisor": still there, and the strongest succession signal
  // there is, so the plain word "founder" must not be treated as gone.
  const out = cleanOtherPeople([{ name: "John Wahl", title: "Founder and Trusted Advisor", relationship: "father of David" }], []);
  assert.deepEqual(out.map((p) => p.name), ["John Wahl"]);
});
