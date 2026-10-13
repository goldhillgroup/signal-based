import { test } from "node:test";
import assert from "node:assert/strict";
import { withDbRetry, isDuplicateKey, isTransient } from "../lib/pipeline/db-retry.js";

test("a transient failure is retried and the eventual success is returned", async () => {
  let calls = 0;
  const r = await withDbRetry(async () => {
    calls++;
    return calls < 3 ? { data: null, error: { message: "fetch failed" } } : { data: { id: "x" }, error: null };
  }, 3, 1);
  assert.equal(calls, 3);
  assert.deepEqual(r.data, { id: "x" });
});

test("a real rejection is NOT retried -- it would fail the same way every time", async () => {
  let calls = 0;
  const r = await withDbRetry(async () => {
    calls++;
    return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
  }, 3, 1);
  assert.equal(calls, 1);
  assert.ok(r.error);
});

test("gives up after the attempts and reports the last error", async () => {
  let calls = 0;
  const r = await withDbRetry(async () => {
    calls++;
    return { data: null, error: { message: "fetch failed" } };
  }, 3, 1);
  assert.equal(calls, 3);
  assert.equal(r.error?.message, "fetch failed");
});

test("a thrown transport error is treated as transient too", async () => {
  let calls = 0;
  const r = await withDbRetry(async () => {
    calls++;
    if (calls === 1) throw new Error("fetch failed");
    return { data: { ok: true }, error: null };
  }, 3, 1);
  assert.equal(calls, 2);
  assert.deepEqual(r.data, { ok: true });
});

test("recognises a duplicate key however it is worded", () => {
  assert.ok(isDuplicateKey({ code: "23505" }));
  assert.ok(isDuplicateKey({ message: 'duplicate key value violates unique constraint "companies_search_domain_idx"' }));
  assert.ok(!isDuplicateKey({ message: "fetch failed" }));
  assert.ok(isTransient({ message: "TypeError: fetch failed" }));
  assert.ok(!isTransient({ message: "column does not exist" }));
});
