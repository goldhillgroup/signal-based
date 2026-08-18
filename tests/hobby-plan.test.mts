/**
 * This app must run on Vercel's FREE Hobby plan. These tests fail the build if
 * anything drifts above that ceiling.
 *
 * Setting `maxDuration` above the plan's limit does not clamp — it fails the
 * deploy. And the four numbers below have to move together or the reaper starts
 * closing out runs that are still writing, marking healthy searches as killed.
 *
 * Pro was considered and rejected on measurement, not principle: it raises the
 * limit to 800s, which still does not fit a large search (~5.2s per company →
 * 300s reads ~57, 800s reads ~150, a target of 100 needs ~240). The app instead
 * runs in passes, stopping cleanly before the platform kills it and resuming.
 * So Pro would cost money and still not remove the pass mechanism.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RUN_CEILING_MS } from "../lib/pipeline/reap.js";

const ROOT = path.join(import.meta.dirname, "..");
const HOBBY_CEILING_S = 300;

/** Every route that declares one, as `path -> seconds`. */
function declaredDurations(): Map<string, number> {
  const found = new Map<string, number>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") {
        const m = fs.readFileSync(p, "utf8").match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
        if (m) found.set(path.relative(ROOT, p), Number(m[1]));
      }
    }
  };
  walk(path.join(ROOT, "app"));
  return found;
}

test("no route exceeds the free plan's function limit", () => {
  const routes = declaredDurations();
  assert.ok(routes.size >= 4, `expected several routes to declare maxDuration, found ${routes.size}`);
  for (const [file, secs] of routes) {
    assert.ok(
      secs <= HOBBY_CEILING_S,
      `${file} declares maxDuration ${secs}s, above the ${HOBBY_CEILING_S}s Hobby ceiling — this fails the deploy`
    );
  }
});

test("the reaper's ceiling matches the longest route, to the millisecond", () => {
  const longest = Math.max(...declaredDurations().values());
  assert.equal(
    RUN_CEILING_MS,
    longest * 1000,
    "RUN_CEILING_MS and maxDuration disagree — the reaper will either close out live runs or leave dead ones running"
  );
});

test("vercel.json declares no cron", () => {
  // NOTHING RUNS ON ITS OWN, which is what Jonathan has been told in writing
  // and what he is charged on. A cron block is the one thing that could start
  // spending without a person pressing anything, so its absence is asserted
  // rather than assumed.
  const p = path.join(ROOT, "vercel.json");
  if (!fs.existsSync(p)) return;
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.ok(!cfg.crons, "vercel.json has a cron block; nothing may run without a person starting it");
});

test("the pipeline stops itself before the platform kills it", async () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/pipeline/orchestrator.ts"), "utf8");
  const m = src.match(/DEADLINE_MARGIN_MS\s*=\s*([\d_]+)/);
  assert.ok(m, "the self-imposed deadline margin has been removed");
  const margin = Number(m[1].replace(/_/g, ""));
  // Enough to finish the company in flight and write the row. Too small and a
  // run is killed mid-write; too large and it wastes most of its budget.
  assert.ok(margin >= 20_000, `margin ${margin}ms is too tight to finish a write`);
  assert.ok(margin < RUN_CEILING_MS / 2, `margin ${margin}ms throws away most of the run`);
});
