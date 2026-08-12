/**
 * A vendor being unavailable is not a verdict about a company.
 *
 * This is written from a real incident. Mid-run, the OpenRouter balance hit
 * zero. Every subsequent classify threw 402, the per-company handler caught it
 * and wrote a REJECTION, and the run finished reporting:
 *
 *     status complete   read 80   kept 0   cut 75   $1.678
 *
 * Seventy-two real manufacturers were marked "could not be judged", entered
 * cross-search memory as settled, and were scheduled to be SKIPPED for two
 * weeks. No error was recorded anywhere. The run had spent $1.68 fetching
 * pages it then never read, and the output was indistinguishable from a
 * thorough search that found nothing.
 *
 * That is the worst shape a failure can take: it looks like an answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { VendorUnavailableError } from "../lib/pipeline/openrouter.js";

test("the outage error carries a sentence the client can act on", () => {
  const e = new VendorUnavailableError(
    "OpenRouter is out of credit, so no company could be judged. Nothing was recorded against the companies this run fetched — add credit in Settings and run it again.",
    402,
    "insufficient credits"
  );
  assert.ok(e instanceof Error);
  assert.equal(e.status, 402);
  // It must say what happened, that nothing was recorded, and what to do.
  assert.match(e.message, /out of credit/i);
  assert.match(e.message, /nothing was recorded/i);
  assert.match(e.message, /settings/i);
  // And it must NOT read like a verdict about a company.
  assert.doesNotMatch(e.message, /could not be judged automatically|queued to be checked/i);
});

test("it is distinguishable from an ordinary per-page failure", () => {
  // The orchestrator branches on exactly this, so the type has to survive.
  const vendor = new VendorUnavailableError("out of credit", 402, "");
  const parse = new Error("Could not parse JSON from model output: {\"companyName\"");
  assert.ok(vendor instanceof VendorUnavailableError);
  assert.ok(!(parse instanceof VendorUnavailableError));
  assert.equal(vendor.name, "VendorUnavailableError");
});

test("every status that means 'the vendor cannot answer' is covered", () => {
  // 402 out of credit, 401/403 bad key, 429 rate limited. None of them say
  // anything whatever about the page being read.
  for (const status of [401, 402, 403, 429]) {
    const e = new VendorUnavailableError("m", status, "");
    assert.equal(e.status, status);
  }
});

test("a capped key is not a broken key", () => {
  // OpenRouter caps spend PER KEY, separately from the account balance. That
  // is the right way to bound a runaway search, and it fired here while the
  // account still held $8.07. Reporting it as "rejected the API key" sends
  // someone to rotate a key that is perfectly good.
  const capped = new VendorUnavailableError(
    "This OpenRouter key has reached the spend limit set on it, so no company could be judged. The account may still hold credit — the cap is on the key itself. Raise it in the OpenRouter dashboard, or paste a different key into Settings. Nothing was recorded against the companies this run fetched.",
    403,
    "Key limit exceeded (total limit)"
  );
  assert.match(capped.message, /spend limit set on it/i);
  assert.match(capped.message, /account may still hold credit/i);
  assert.doesNotMatch(capped.message, /rejected the api key/i);
});
