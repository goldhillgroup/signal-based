/**
 * Paid-for candidates left unread at the end of a pass are carried into the next one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { packQueue, unpackQueue, MAX_SAVED, MAX_AGE_MS, queueKey } from "../lib/pipeline/candidate-queue.js";
import type { Candidate } from "../lib/pipeline/apify.js";

const cand = (domain: string, channel: Candidate["channel"] = "web_search", extra: Partial<Candidate> = {}): Candidate => ({
  domain, url: `https://${domain}/`, title: `${domain} title`, channel, ...extra,
});

test("what is saved comes back, with its place, phone and channel", () => {
  const raw = packQueue([cand("a.com", "web_search", { state: "OH" }), cand("b.com", "maps", { phone: "(614) 555-0100", city: "Columbus", address: "1 Main St" })], 1_000);
  const out = unpackQueue(raw, { seen: new Set(), now: 2_000 });
  assert.deepEqual(out.map((c) => c.domain), ["a.com", "b.com"]);
  assert.equal(out[0].state, "OH");
  assert.equal(out[1].phone, "(614) 555-0100");
  assert.equal(out[1].city, "Columbus");
  assert.equal(out[1].channel, "maps");
});

test("re-checks are not carried, they are chosen afresh each pass", () => {
  const raw = packQueue([cand("a.com"), cand("old.com", "recheck")]);
  assert.deepEqual(unpackQueue(raw, { seen: new Set() }).map((c) => c.domain), ["a.com"]);
});

test("a company another search has settled since is dropped", () => {
  const raw = packQueue([cand("a.com"), cand("b.com")]);
  assert.deepEqual(unpackQueue(raw, { seen: new Set(["a.com"]) }).map((c) => c.domain), ["b.com"]);
});

test("a stale queue is not carried", () => {
  const raw = packQueue([cand("a.com")], 1_000);
  assert.deepEqual(unpackQueue(raw, { seen: new Set(), now: 1_000 + MAX_AGE_MS + 1 }), []);
  assert.equal(unpackQueue(raw, { seen: new Set(), now: 1_000 + MAX_AGE_MS - 1 }).length, 1);
});

test("garbage costs only the head start, never a wrong company", () => {
  for (const bad of [null, undefined, "", "   ", "not json", "{}", '{"at":1,"items":"x"}', '{"at":"x","items":[]}', "[]"]) {
    assert.deepEqual(unpackQueue(bad as never, { seen: new Set(), now: 2 }), []);
  }
  const raw = JSON.stringify({ at: 1, items: [null, 3, {}, { d: "x.com" }, { d: "y.com", u: "https://y.com", c: "nonsense" }, { d: "ok.com", u: "https://ok.com", c: "maps" }] });
  assert.deepEqual(unpackQueue(raw, { seen: new Set(), now: 2 }).map((c) => c.domain), ["ok.com"]);
});

test("a company listed twice is read once, and the list is bounded", () => {
  const raw = packQueue([cand("a.com"), cand("A.com"), ...Array.from({ length: 300 }, (_, i) => cand(`z${i}.com`))]);
  const out = unpackQueue(raw, { seen: new Set() });
  assert.ok(out.length <= MAX_SAVED);
  assert.equal(out.filter((c) => c.domain === "a.com").length, 1);
});

test("one key per search", () => {
  assert.equal(queueKey("abc"), "queue:abc");
});
