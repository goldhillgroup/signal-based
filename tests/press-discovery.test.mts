import { test } from "node:test";
import assert from "node:assert/strict";
import { toCandidates, type PressFind } from "../lib/pipeline/press-discovery.js";
import type { Industry } from "../lib/supabase/types.js";

const IND: Industry[] = ["landscaping"];
const find = (o: Partial<PressFind>): PressFind => ({
  name: "Hansen Landscaping",
  website: "https://hansenlandscaping.com/about",
  quote: "Bill is handing the business to his daughter Erin.",
  sourceUrl: "https://gadsdentimes.com/story/123",
  ...o,
});

test("the company is returned, not the newspaper", () => {
  const out = toCandidates([find({})], IND, ["CT"], new Set(), 10);
  assert.equal(out.length, 1);
  assert.equal(out[0].domain, "hansenlandscaping.com");
  assert.equal(out[0].channel, "press");
});

test("a publisher writing about itself is dropped", () => {
  // The failure this channel exists to avoid: handing back the article's own
  // host, which costs a fetch and a classify to rediscover it is a newspaper.
  const out = toCandidates(
    [find({ website: "https://gadsdentimes.com/subscribe" })],
    IND, ["CT"], new Set(), 10
  );
  assert.deepEqual(out, []);
});

test("the reporter's sentence travels with the candidate", () => {
  const [c] = toCandidates([find({})], IND, ["CT"], new Set(), 10);
  assert.equal(
    (c as { pressQuote?: string }).pressQuote,
    "Bill is handing the business to his daughter Erin."
  );
  assert.equal((c as { pressSourceUrl?: string }).pressSourceUrl, "https://gadsdentimes.com/story/123");
});

test("companies already settled are skipped, not re-bought", () => {
  const out = toCandidates([find({})], IND, ["CT"], new Set(["hansenlandscaping.com"]), 10);
  assert.deepEqual(out, []);
});

test("one company mentioned three times is one candidate", () => {
  const out = toCandidates(
    [
      find({}),
      find({ website: "https://www.hansenlandscaping.com/" }),
      find({ website: "https://hansenlandscaping.com/contact" }),
    ],
    IND, ["CT"], new Set(), 10
  );
  assert.equal(out.length, 1, "www. and a different path are the same company");
});

test("a find with no usable website is dropped, never guessed", () => {
  // Constructing a domain from a name is what made directory-discovery invent
  // five of eight; the rule here is to return fewer, never to invent.
  const out = toCandidates([find({ website: "not a url" })], IND, ["CT"], new Set(), 10);
  assert.deepEqual(out, []);
});

test("the limit is honoured", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    find({ website: `https://company${i}.com` })
  );
  assert.equal(toCandidates(many, IND, ["CT"], new Set(), 5).length, 5);
});

test("state is stamped only when the search is one state", () => {
  assert.equal(toCandidates([find({})], IND, ["CT"], new Set(), 5)[0].state, "CT");
  // Twelve states in one call means the article could be about any of them,
  // and a wrong state is worse than none.
  assert.equal(toCandidates([find({})], IND, ["CT", "NY"], new Set(), 5)[0].state, null);
});

test("the publisher filters catch what the live run actually returned", async () => {
  const { isPressWorthy } = await import("../lib/pipeline/press-discovery.js");
  // Measured, not imagined: these are the hosts the first two live runs
  // returned. Social was 5 of 8 on the "general" topic; Fortune was the one
  // company the first working run produced, a billionaire's real-estate
  // empire two orders of magnitude outside the $5-30M band.
  for (const bad of [
    "facebook.com", "instagram.com", "youtube.com", "lawnsite.com",
    "fortune.com", "forbes.com", "bloomberg.com", "cnbc.com",
  ]) {
    assert.equal(isPressWorthy(bad), false, `${bad} should be skipped`);
  }
  // Local and regional press is the whole point of the channel.
  for (const good of ["we-ha.com", "patch.com", "gadsdentimes.com", "augustachronicle.com"]) {
    assert.equal(isPressWorthy(good), true, `${good} should be read`);
  }
});
