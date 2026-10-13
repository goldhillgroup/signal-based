/**
 * "When I combine the exported files, I'm finding duplicate records."
 *
 * Live: 110 domains in more than one row, 14 as a qualified lead in several
 * lists, acmewire.com eleven times.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeCompanies, domainKey } from "../lib/dedupe.js";
import type { Company, Contact } from "../lib/company.js";

const contact = (email: string, name: string | null = null, source = "anymailfinder"): Contact => ({
  name, nameInferred: false, title: null, email, findStatus: "found", findSource: source, verificationStatus: "valid",
});

let n = 0;
const co = (over: Record<string, unknown> = {}): Company & { listName?: string; note?: string | null; ownGrade?: number | null } =>
  ({
    id: `id${++n}`, searchId: "s", domain: "acmewire.com", name: "Acme Wire", industry: "manufacturing",
    state: "CA", city: "Fresno", revenueBand: "Size not stated", employeeBand: "not stated",
    status: "qualified", confidence: null, rejectionReason: null,
    founderName: null, founderTitle: null, nextGenName: null, nextGenTitle: null,
    sourceUrl: null, hasSignal: false, discoveryChannel: "web_search", operatingModel: null,
    firstSeenAt: "2026-10-01T00:00:00Z", lastCrawledAt: "2026-10-01T00:00:00Z",
    phone: null, address: null, evidence: null, contact: null, backupContact: null, allContacts: [],
    ...over,
  }) as never;

test("the same company in several lists becomes one row", () => {
  const rows = [co({ listName: "A" }), co({ listName: "B" }), co({ listName: "C" })];
  const r = dedupeCompanies(rows);
  assert.equal(r.rows.length, 1);
  assert.equal(r.removed, 2);
});

test("www. and case do not hide a duplicate", () => {
  assert.equal(domainKey("WWW.AcmeWire.com"), "acmewire.com");
  assert.equal(dedupeCompanies([co({ domain: "www.acmewire.com" }), co({ domain: "AcmeWire.com" })]).rows.length, 1);
});

test("different companies are left alone", () => {
  const r = dedupeCompanies([co({ domain: "a.com" }), co({ domain: "b.com" }), co({ domain: "c.com" })]);
  assert.equal(r.rows.length, 3);
  assert.equal(r.removed, 0);
});

test("a lead beats a cut, a pair beats a fit, and the order is not what decides", () => {
  const cut = co({ status: "rejected", listName: "cut" });
  const fit = co({ status: "qualified", hasSignal: false, listName: "fit" });
  const pair = co({ status: "qualified", hasSignal: true, confidence: "high", listName: "pair" });
  for (const order of [[cut, fit, pair], [pair, fit, cut], [fit, pair, cut]]) {
    assert.equal(dedupeCompanies(order).rows[0].listName, "pair");
  }
  assert.equal(dedupeCompanies([cut, fit]).rows[0].listName, "fit");
});

test("stronger confidence wins between two pairs", () => {
  const weak = co({ hasSignal: true, confidence: "verify", listName: "weak" });
  const strong = co({ hasSignal: true, confidence: "high", listName: "strong" });
  assert.equal(dedupeCompanies([weak, strong]).rows[0].listName, "strong");
});

test("a row with a personal address beats one without, all else equal", () => {
  const bare = co({ listName: "bare", lastCrawledAt: "2026-10-12T00:00:00Z" });
  const reachable = co({ listName: "reachable", lastCrawledAt: "2026-10-01T00:00:00Z", allContacts: [contact("a@acmewire.com", "A B")], contact: contact("a@acmewire.com", "A B") });
  assert.equal(dedupeCompanies([bare, reachable]).rows[0].listName, "reachable");
});

test("the newest read breaks a tie", () => {
  const old = co({ listName: "old", lastCrawledAt: "2026-08-01T00:00:00Z" });
  const fresh = co({ listName: "fresh", lastCrawledAt: "2026-10-12T00:00:00Z" });
  assert.equal(dedupeCompanies([old, fresh]).rows[0].listName, "fresh");
});

test("an address bought on the LOSING row is not lost", () => {
  const winner = co({ listName: "win", hasSignal: true, confidence: "high" });
  const loser = co({
    listName: "lose",
    allContacts: [contact("paul@acmewire.com", "Paul Turner")],
    contact: contact("paul@acmewire.com", "Paul Turner"),
  });
  const out = dedupeCompanies([winner, loser]).rows[0];
  assert.deepEqual(out.allContacts?.map((k) => k.email), ["paul@acmewire.com"]);
  assert.equal(out.contact?.email, "paul@acmewire.com", "the winner had nobody to write to, so the address takes over");
});

test("both rows' addresses are kept, once each", () => {
  const a = co({ hasSignal: true, confidence: "high", allContacts: [contact("john@acmewire.com", "John Turner"), contact("office@acmewire.com", null, "company-page:role")], contact: contact("john@acmewire.com", "John Turner") });
  const b = co({ allContacts: [contact("john@acmewire.com", "John Turner"), contact("paul@acmewire.com", "Paul Turner")] });
  const out = dedupeCompanies([a, b]).rows[0];
  assert.deepEqual(out.allContacts?.map((k) => k.email).sort(), ["john@acmewire.com", "office@acmewire.com", "paul@acmewire.com"]);
});

test("his own note and grade survive from the losing row", () => {
  const winner = co({ hasSignal: true, confidence: "high" });
  const loser = co({ note: "Spoke to Paul, call back in March", ownGrade: 5 });
  const out = dedupeCompanies([winner, loser]).rows[0];
  assert.equal(out.note, "Spoke to Paul, call back in March");
  assert.equal(out.ownGrade, 5);
});

test("his note on the winner is never overwritten", () => {
  const winner = co({ hasSignal: true, confidence: "high", note: "mine" });
  const loser = co({ note: "other", ownGrade: 2 });
  const out = dedupeCompanies([winner, loser]).rows[0];
  assert.equal(out.note, "mine");
});

test("the other lists are named, so nothing is silent", () => {
  const rows = [co({ listName: "Texas landscapers", hasSignal: true, confidence: "high" }), co({ listName: "Florida" }), co({ listName: "Ohio" })];
  const out = dedupeCompanies(rows).rows[0] as { alsoIn?: string };
  assert.equal(out.alsoIn, "Florida; Ohio");
});

test("order of first appearance is preserved", () => {
  const out = dedupeCompanies([co({ domain: "z.com" }), co({ domain: "a.com" }), co({ domain: "z.com" })]).rows;
  assert.deepEqual(out.map((r) => r.domain), ["z.com", "a.com"]);
});
