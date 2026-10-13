/**
 * The re-check loop that ate every search.
 *
 * Real numbers behind these tests (live database, 2026-10-13): 205 of 209
 * overdue rows were dead or blocked sites, the same alphabetically-first
 * domains were re-read in 9 of the last 10 searches, and a run that made ten
 * model calls reported 66 companies scanned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickRechecks,
  nextRecheckAfter,
  decideLead,
  isFetchFailure,
  normDomain,
  type DueRow,
} from "../lib/pipeline/recheck-selection.js";

const row = (domain: string, reason: string | null, due = "2026-09-01T00:00:00Z"): DueRow => ({
  domain,
  source_url: null,
  state: "CA",
  rejection_reason: reason,
  recheck_after: due,
  first_seen_at: "2026-08-01T00:00:00Z",
});

const DEAD = "No About/Team/Leadership page could be fetched from this domain";
const JUDGED = "Cut - only one generation is on the leadership page, no founder-and-next-gen pair shown together.";

test("a dead domain is recognised by the wording the pipeline actually writes", () => {
  assert.ok(isFetchFailure(DEAD));
  assert.ok(isFetchFailure("Page too thin to evaluate, likely a JS-rendered shell or placeholder page"));
  assert.ok(isFetchFailure("Could not be judged automatically. The page was read but the result came back unreadable"));
  assert.ok(!isFetchFailure(JUDGED));
  assert.ok(!isFetchFailure("No longer family-owned, acquired/consolidated"));
  assert.ok(!isFetchFailure(null));
});

test("companies that were actually weighed come before dead domains", () => {
  const picks = pickRechecks(
    [row("dead1.com", DEAD), row("dead2.com", DEAD), row("judged.com", JUDGED)],
    { skip: new Set(), cap: 5 }
  );
  assert.equal(picks[0].domain, "judged.com");
});

test("dead domains get a small fixed allowance, not whatever is left over", () => {
  const dead = Array.from({ length: 20 }, (_, i) => row(`dead${i}.com`, DEAD));
  const picks = pickRechecks(dead, { skip: new Set(), cap: 10, failureCap: 3 });
  assert.equal(picks.length, 3, "only three of twenty dead domains may be re-read in one pass");
});

test("the cap is a hard ceiling across both groups", () => {
  const due = [
    ...Array.from({ length: 10 }, (_, i) => row(`j${i}.com`, JUDGED)),
    ...Array.from({ length: 10 }, (_, i) => row(`d${i}.com`, DEAD)),
  ];
  assert.ok(pickRechecks(due, { skip: new Set(), cap: 8 }).length <= 8);
});

test("a domain already settled elsewhere is never re-read", () => {
  // acmewire.com was a qualified lead in seven folders and still got re-read,
  // because its OLD rejected row came due while the lead row was ignored.
  const picks = pickRechecks([row("acmewire.com", DEAD), row("other.com", JUDGED)], {
    skip: new Set(["acmewire.com"]),
    cap: 5,
  });
  assert.deepEqual(picks.map((p) => p.domain), ["other.com"]);
});

test("www. and case do not hide a duplicate", () => {
  const picks = pickRechecks([row("WWW.Example.com", JUDGED), row("example.com", JUDGED)], {
    skip: new Set(),
    cap: 5,
  });
  assert.equal(picks.length, 1);
  assert.equal(normDomain("WWW.Example.com"), "example.com");
});

test("junk hosts are dropped before they cost a fetch", () => {
  const picks = pickRechecks([row("agents.allstate.com", DEAD), row("real.com", JUDGED)], {
    skip: new Set(),
    cap: 5,
    junk: (d) => d.endsWith("allstate.com"),
  });
  assert.deepEqual(picks.map((p) => p.domain), ["real.com"]);
});

test("oldest-due first, so the list rotates instead of returning the same head", () => {
  const picks = pickRechecks(
    [row("b.com", JUDGED, "2026-09-10T00:00:00Z"), row("a.com", JUDGED, "2026-09-20T00:00:00Z"), row("c.com", JUDGED, "2026-09-01T00:00:00Z")],
    { skip: new Set(), cap: 2 }
  );
  assert.deepEqual(picks.map((p) => p.domain), ["c.com", "b.com"]);
});

test("a judged verdict keeps the policy's schedule", () => {
  const base = "2026-12-01T00:00:00.000Z";
  assert.equal(
    nextRecheckAfter({ baseIso: base, oldReason: JUDGED, newReason: JUDGED, firstSeenAt: "2026-01-01T00:00:00Z" }),
    base
  );
});

test("a repeat failure backs off instead of coming due every fortnight", () => {
  const now = new Date("2026-10-13T00:00:00Z");
  const fortnight = new Date("2026-10-27T00:00:00Z").toISOString();
  const next = nextRecheckAfter({
    baseIso: fortnight,
    oldReason: DEAD,
    newReason: DEAD,
    firstSeenAt: "2026-06-13T00:00:00Z", // 122 days old
    now,
  });
  assert.ok(next && next > fortnight, "must be later than the flat 14 days");
  const days = Math.round((new Date(next!).getTime() - now.getTime()) / 86_400_000);
  assert.ok(days >= 100 && days <= 180, `expected roughly the row's age, got ${days} days`);
});

test("backoff is capped, and never earlier than the policy", () => {
  const now = new Date("2026-10-13T00:00:00Z");
  const base = new Date("2026-10-27T00:00:00Z").toISOString();
  const ancient = nextRecheckAfter({ baseIso: base, oldReason: DEAD, newReason: DEAD, firstSeenAt: "2020-01-01T00:00:00Z", now });
  assert.ok(Math.round((new Date(ancient!).getTime() - now.getTime()) / 86_400_000) <= 180);
  const fresh = nextRecheckAfter({ baseIso: base, oldReason: DEAD, newReason: DEAD, firstSeenAt: "2026-10-12T00:00:00Z", now });
  assert.ok(fresh! >= base);
});

test("a permanent verdict stays permanent", () => {
  assert.equal(nextRecheckAfter({ baseIso: null, oldReason: DEAD, newReason: DEAD, firstSeenAt: null }), null);
});

test("no lead on file: store the new one", () => {
  assert.deepEqual(decideLead([], { hasSignal: false }), { action: "insert" });
});

test("a lead already on file: do not add a second row for the same company", () => {
  assert.deepEqual(decideLead([{ id: "a", has_signal: false }], { hasSignal: false }), { action: "skip" });
  assert.deepEqual(decideLead([{ id: "a", has_signal: true }], { hasSignal: true }), { action: "skip" });
  assert.deepEqual(decideLead([{ id: "a", has_signal: true }], { hasSignal: false }), { action: "skip" });
});

test("the one exception: a fit-only lead that has since grown a real pair", () => {
  const d = decideLead([{ id: "a", has_signal: false }, { id: "b", has_signal: null }], { hasSignal: true });
  assert.deepEqual(d, { action: "supersede", ids: ["a", "b"] });
});

test("a pair already on file is never superseded by another pair", () => {
  assert.equal(decideLead([{ id: "a", has_signal: true }, { id: "b", has_signal: false }], { hasSignal: true }).action, "skip");
});
