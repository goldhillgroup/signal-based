/**
 * A classify call occasionally comes back EMPTY (finish_reason: length) because the
 * model's hidden reasoning used the whole token budget. The retry must turn the
 * reasoning down, or it fails the same way and the company is cut unread.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// No database in a unit test: the settings lookup is pointed at a dummy URL and answered by the stub below.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
process.env.OPENROUTER_API_KEY = "test-key";
const { classifySignal } = await import("../lib/pipeline/openrouter.js");

test("after an empty answer the retry asks for low reasoning effort and a bigger budget", async () => {
  const bodies: Record<string, unknown>[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (!String(url).includes("openrouter.ai")) return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
    bodies.push(JSON.parse(String(init?.body)));
    const content = bodies.length === 1 ? "" : JSON.stringify({ companyName: "X", qualifies: false, industry: "other" });
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: bodies.length === 1 ? "length" : "stop" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const r = await classifySignal("t", "https://x.example/", "page text ".repeat(100), null);
    assert.equal(r.qualifies, false);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(bodies.length, 2, "one retry, no more");
  assert.equal(bodies[0].max_tokens, 2400);
  assert.equal(bodies[0].reasoning, undefined, "the first attempt is exactly as it always was");
  assert.equal(bodies[1].max_tokens, 4000);
  assert.deepEqual(bodies[1].reasoning, { effort: "low" });
});
