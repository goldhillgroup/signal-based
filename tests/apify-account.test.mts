/**
 * Every Apify call bills the client's own account.
 *
 * There used to be a fallback: APIFY_TOKEN_4, a developer's personal account
 * with a $17 self-imposed cap, tried FIRST so that build-and-test spend stayed
 * off the client's card. Correct while the thing was being built, wrong once it
 * was handed over — it is somebody else's money, and they are no longer being
 * paid to lend it.
 *
 * It is DELETED rather than unset. "Do not put APIFY_TOKEN_4 in production" is a
 * rule somebody has to remember every time an environment is copied, and it had
 * already survived several rounds of documentation warning about it. This test
 * is what makes it stay gone: a code path that cannot be reached cannot be
 * re-enabled by pasting an env file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

test("no source file reads the developer's token", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["node_modules", ".next", ".git"].includes(e.name)) continue;
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx|mts)$/.test(e.name)) continue;
      // This test names it, and a comment explaining the removal is fine.
      if (p.endsWith("apify-account.test.mts")) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const line of src.split("\n")) {
        // A mention in a comment is history; a read is a live path back to it.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (/APIFY_TOKEN_4/.test(line)) offenders.push(`${path.relative(ROOT, p)}: ${line.trim()}`);
      }
    }
  };
  for (const d of ["lib", "app", "components", "scripts"]) walk(path.join(ROOT, d));
  assert.deepEqual(offenders, [], `these still reach the developer's account:\n${offenders.join("\n")}`);
});

test("the budget ceiling is the client's plan, not a borrowed cap", async () => {
  const { CLIENT_PLAN_USD, BUDGET_CAP_USD } = await import("../lib/pipeline/apify.js");
  assert.equal(CLIENT_PLAN_USD, 29, "the signed scope is a $29/mo Apify plan");
  assert.equal(BUDGET_CAP_USD, CLIENT_PLAN_USD, "nothing may cap spend below the client's own plan");
});

test("the developer cap constant is gone entirely", async () => {
  const mod = (await import("../lib/pipeline/apify.js")) as Record<string, unknown>;
  assert.equal(mod.DEV_CAP_USD, undefined, "DEV_CAP_USD survived, so the fallback can be rebuilt around it");
});
