/**
 * A key is saved only if its vendor confirms it. (2026-10-14: "25" replaced the working
 * OpenRouter key and every search failed with HTTP 401.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkKeyWithVendor } from "../lib/key-check.js";

const KEYS = ["OPENROUTER_API_KEY", "APIFY_TOKEN", "TAVILY_API_KEY", "FIRECRAWL_API_KEY", "ANYMAILFINDER_API_KEY", "MILLIONVERIFIER_API_KEY"];
const answer = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

test("every vendor: a key the vendor accepts is valid", async () => {
  for (const k of KEYS) {
    const body = k === "MILLIONVERIFIER_API_KEY" ? { credits: 1200 } : { ok: true };
    assert.equal((await checkKeyWithVendor(k, "x".repeat(40), answer(200, body))).verdict, "valid", k);
  }
});

test("every vendor: a 401 or 403 is refused, and says nothing was saved and the old key is untouched", async () => {
  for (const k of KEYS) for (const status of [401, 403]) {
    const r = await checkKeyWithVendor(k, "x".repeat(40), answer(status));
    assert.equal(r.verdict, "invalid", `${k} ${status}`);
    assert.match((r as { message: string }).message, /nothing was saved/);
    assert.match((r as { message: string }).message, /untouched/);
  }
});

test("MillionVerifier answers 200 with an error for a junk key, and that is still refused", async () => {
  const r = await checkKeyWithVendor("MILLIONVERIFIER_API_KEY", "x".repeat(30), answer(200, { result: "error", error: "apikey_not_found" }));
  assert.equal(r.verdict, "invalid");
  assert.match((r as { message: string }).message, /apikey_not_found/);
});

test("when the vendor cannot say (timeout, outage, rate limit), nothing is saved", async () => {
  for (const status of [429, 500, 502, 503]) {
    assert.equal((await checkKeyWithVendor("TAVILY_API_KEY", "x".repeat(40), answer(status))).verdict, "unreachable", String(status));
  }
  const down = (async () => { throw new Error("ECONNRESET"); }) as typeof fetch;
  const r = await checkKeyWithVendor("APIFY_TOKEN", "x".repeat(40), down);
  assert.equal(r.verdict, "unreachable");
  assert.match((r as { message: string }).message, /Try again/);
});

test("an unexpected 4xx means our endpoint may have moved, not that the key is bad", async () => {
  assert.equal((await checkKeyWithVendor("FIRECRAWL_API_KEY", "x".repeat(40), answer(404))).verdict, "unknown");
});

test("the key itself never appears in a message", async () => {
  const key = "sk-or-v1-SECRETSECRETSECRETSECRET";
  for (const status of [401, 503]) {
    const r = await checkKeyWithVendor("OPENROUTER_API_KEY", key, answer(status));
    assert.ok(!JSON.stringify(r).includes("SECRET"), `${status}`);
  }
});

test("the request goes to the right vendor with the key in the right place", async () => {
  const seen: { url: string; auth: string | null }[] = [];
  const spy = (async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify({ credits: 5 }), { status: 200 });
  }) as unknown as typeof fetch;
  await checkKeyWithVendor("OPENROUTER_API_KEY", "sk-or-AAAAAAAAAAAAAAAA", spy);
  await checkKeyWithVendor("APIFY_TOKEN", "tok123456789012345", spy);
  await checkKeyWithVendor("MILLIONVERIFIER_API_KEY", "mv1234567890123456", spy);
  assert.equal(seen[0].url, "https://openrouter.ai/api/v1/key");
  assert.equal(seen[0].auth, "Bearer sk-or-AAAAAAAAAAAAAAAA");
  assert.match(seen[1].url, /api\.apify\.com\/v2\/users\/me\?token=tok123456789012345/);
  assert.equal(seen[1].auth, null);
  assert.match(seen[2].url, /millionverifier\.com\/api\/v3\/credits\?api=mv1234567890123456/);
});
