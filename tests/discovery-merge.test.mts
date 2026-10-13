/**
 * A discovery round used to wait for its slowest channel (Google Maps, which is
 * also the one that yields least) before a single company could be read. These
 * pin the two-part hand-over that replaces it, and that the merge underneath is
 * the same one as before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { progressiveDiscovery, CHANNEL_NAMES } from "../lib/pipeline/discovery-merge.js";

interface Raw {
  url: string;
  channel: string;
  state?: string | null;
}
interface Kept {
  domain: string;
  channel: string;
  state: string | null;
}

const raw = (host: string, channel: string, state?: string): Raw => ({ url: `https://${host}/`, channel, state });
const convert = (r: Raw, seen: Set<string>): Kept | null => {
  const host = new URL(r.url).hostname.replace(/^www\./, "");
  if (host.startsWith("blocked.") || seen.has(host)) return null;
  seen.add(host);
  return { domain: host, channel: r.channel, state: r.state ?? null };
};

const after = <T,>(ms: number, value: T): Promise<T> => new Promise((r) => setTimeout(() => r(value), ms));
const failAfter = (ms: number, message: string): Promise<Raw[]> =>
  new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms));
const domains = (xs: Kept[]) => xs.map((x) => x.domain);

/** One group: Directory, Licensing, Web search, Maps. */
const oneGroup = (dir: Promise<Raw[]>, lic: Promise<Raw[]>, web: Promise<Raw[]>, maps: Promise<Raw[]>, state = "TX") => ({
  tasks: [dir, lic, web, maps],
  groups: [[state]],
});

test("reading can start when web search answers, without waiting for Maps", async () => {
  const t0 = Date.now();
  const { tasks, groups } = oneGroup(
    after(5, []),
    after(0, []),
    after(10, [raw("a.com", "web_search"), raw("b.com", "web_search")]),
    after(500, [raw("c.com", "maps")])
  );
  const { first, rest } = progressiveDiscovery({ tasks, groups, graceMs: 30, convert });

  const f = await first;
  const firstAt = Date.now() - t0;
  assert.deepEqual(domains(f.candidates), ["a.com", "b.com"]);
  assert.ok(firstAt < 350, `first part took ${firstAt}ms; it should not have waited for the 500ms Maps call`);

  const r = await rest;
  assert.deepEqual(domains(r.candidates), ["c.com"], "Maps' candidates are delivered afterwards, not dropped");
  assert.ok(Date.now() - t0 >= 480);
});

test("a company that two channels both found is handed over once", async () => {
  const { tasks, groups } = oneGroup(
    after(0, []),
    after(0, []),
    after(5, [raw("same.com", "web_search")]),
    after(120, [raw("same.com", "maps"), raw("other.com", "maps")])
  );
  const { first, rest } = progressiveDiscovery({ tasks, groups, graceMs: 20, convert });
  assert.deepEqual(domains((await first).candidates), ["same.com"]);
  assert.deepEqual(domains((await rest).candidates), ["other.com"], "same.com is not read twice");
});

test("domains already settled are never returned in either part", async () => {
  const { tasks, groups } = oneGroup(
    after(0, []),
    after(0, []),
    after(5, [raw("known.com", "web_search"), raw("new.com", "web_search")]),
    after(60, [raw("known.com", "maps"), raw("new2.com", "maps")])
  );
  const { first, rest } = progressiveDiscovery({ tasks, groups, graceMs: 10, convert, exclude: new Set(["known.com"]) });
  assert.deepEqual(domains((await first).candidates), ["new.com"]);
  assert.deepEqual(domains((await rest).candidates), ["new2.com"]);
});

test("a channel that answers inside the grace window comes with the first part", async () => {
  const { tasks, groups } = oneGroup(
    after(25, [raw("dir.com", "directory")]),
    after(0, []),
    after(5, [raw("web.com", "web_search")]),
    after(400, [raw("maps.com", "maps")])
  );
  const { first } = progressiveDiscovery({ tasks, groups, graceMs: 80, convert });
  assert.deepEqual(domains((await first).candidates).sort(), ["dir.com", "web.com"]);
});

test("when web search is the slowest, everything is in the first part and nothing is left", async () => {
  const { tasks, groups } = oneGroup(
    after(0, []),
    after(0, []),
    after(60, [raw("web.com", "web_search")]),
    after(5, [raw("maps.com", "maps")])
  );
  const { first, rest } = progressiveDiscovery({ tasks, groups, graceMs: 20, convert });
  assert.deepEqual(domains((await first).candidates).sort(), ["maps.com", "web.com"]);
  assert.deepEqual((await rest).candidates, []);
});

test("with nothing to read yet, the first part waits for the rest instead of coming back empty", async () => {
  const t0 = Date.now();
  const { tasks, groups } = oneGroup(
    after(0, []),
    after(0, []),
    after(5, []), // web search found nothing
    after(90, [raw("maps.com", "maps")])
  );
  const { first, rest } = progressiveDiscovery({ tasks, groups, graceMs: 15, convert });
  const f = await first;
  assert.deepEqual(domains(f.candidates), ["maps.com"]);
  assert.ok(Date.now() - t0 >= 85, "it waited for Maps rather than reporting an empty round");
  assert.deepEqual((await rest).candidates, []);
});

test("an infinite grace is the old behaviour: one result, after everything has answered", async () => {
  const t0 = Date.now();
  const { tasks, groups } = oneGroup(
    after(10, [raw("dir.com", "directory")]),
    after(0, []),
    after(5, [raw("web.com", "web_search"), raw("dir.com", "web_search")]),
    after(80, [raw("maps.com", "maps"), raw("web.com", "maps")])
  );
  const { first, rest } = progressiveDiscovery({ tasks, groups, graceMs: Infinity, convert });
  const f = await first;
  assert.ok(Date.now() - t0 >= 75);
  // Channel order is the priority when two channels return the same company.
  assert.deepEqual(f.candidates.map((c) => `${c.domain}:${c.channel}`), [
    "dir.com:directory",
    "web.com:web_search",
    "maps.com:maps",
  ]);
  assert.deepEqual((await rest).candidates, []);
});

test("blocked hosts never come through", async () => {
  const { tasks, groups } = oneGroup(after(0, []), after(0, []), after(1, [raw("blocked.example.com", "web_search"), raw("ok.com", "web_search")]), after(0, []));
  const { first } = progressiveDiscovery({ tasks, groups, graceMs: 5, convert });
  assert.deepEqual(domains((await first).candidates), ["ok.com"]);
});

test("all three searching channels failing raises, with the same wording as before", async () => {
  const { tasks, groups } = oneGroup(failAfter(1, "tavily down"), after(0, []), failAfter(2, "apify 402"), failAfter(3, "maps 502"));
  const { first, rest } = progressiveDiscovery({ tasks, groups, graceMs: 10, convert });
  await assert.rejects(first, (e: Error) => {
    assert.match(e.message, /Directory channel failed: tavily down/);
    assert.match(e.message, /Web search channel failed: apify 402/);
    assert.match(e.message, /Maps channel failed: maps 502/);
    assert.ok(!/Licensing/.test(e.message), "a working licensing channel is not named");
    return true;
  });
  // And the second part must not become an unhandled rejection.
  assert.deepEqual(await rest, { candidates: [], channelErrors: [] });
});

test("licensing alone returning nothing does not make an otherwise dead run look healthy", async () => {
  // Licensing resolves [] for most states, so it must not count among the three.
  const { tasks, groups } = oneGroup(failAfter(1, "d"), after(0, []), failAfter(1, "w"), failAfter(1, "m"));
  const { first } = progressiveDiscovery({ tasks, groups, graceMs: 5, convert });
  await assert.rejects(first);
});

test("one state's failure is named, and does not condemn the channel", async () => {
  const groups = [["TX"], ["OK"]];
  const tasks: Promise<Raw[]>[] = [
    // TX group: Directory, Licensing, Web search, Maps
    after(0, []), after(0, []), after(2, [raw("tx.com", "web_search")]), after(0, []),
    // OK group
    after(0, []), after(0, []), failAfter(2, "timeout"), after(0, []),
  ];
  const { first } = progressiveDiscovery({ tasks, groups, graceMs: 10, convert });
  const f = await first;
  assert.deepEqual(domains(f.candidates), ["tx.com"]);
  assert.deepEqual(f.channelErrors, ["Web search channel failed for OK only"]);
});

test("a slow channel's failure is reported once, by the part that learns of it", async () => {
  const { tasks, groups } = oneGroup(after(0, []), after(0, []), after(3, [raw("web.com", "web_search")]), failAfter(80, "maps exploded"));
  const { first, rest } = progressiveDiscovery({ tasks, groups, graceMs: 10, convert });
  const f = await first;
  assert.deepEqual(f.channelErrors, [], "Maps had not answered yet, so it is not reported as failed");
  const r = await rest;
  assert.deepEqual(r.channelErrors, ["Maps channel failed: maps exploded"]);
});

test("a failure that is known by the first hand-over is not repeated in the second", async () => {
  const { tasks, groups } = oneGroup(failAfter(1, "dir down"), after(0, []), after(3, [raw("web.com", "web_search")]), after(60, [raw("m.com", "maps")]));
  const { first, rest } = progressiveDiscovery({ tasks, groups, graceMs: 15, convert });
  assert.deepEqual((await first).channelErrors, ["Directory channel failed: dir down"]);
  assert.deepEqual((await rest).channelErrors, []);
});

test("a single-state group stamps its state on what it found; a multi-state group does not guess", async () => {
  const single = oneGroup(after(0, []), after(0, []), after(1, [raw("tx.com", "web_search")]), after(0, []), "TX");
  const a = await progressiveDiscovery({ ...single, graceMs: 5, convert }).first;
  assert.equal(a.candidates[0].state, "TX");

  const multi = {
    tasks: [after(0, [] as Raw[]), after(0, [] as Raw[]), after(1, [raw("x.com", "web_search")]), after(0, [] as Raw[])],
    groups: [["TX", "OK"]],
  };
  const b = await progressiveDiscovery({ ...multi, graceMs: 5, convert }).first;
  assert.equal(b.candidates[0].state, null);
});

test("channel names are the ones the health check parses", () => {
  assert.deepEqual([...CHANNEL_NAMES], ["Directory", "Licensing", "Web search", "Maps"]);
});
