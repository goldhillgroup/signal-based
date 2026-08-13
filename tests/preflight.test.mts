/**
 * The gate that refuses a search BEFORE money moves.
 *
 * The failure this exists to prevent, measured on the live key the day it was
 * written: the ACCOUNT reported $8.07 available while the KEY reported
 * limit $5, usage $5.05, limit_remaining 0. Preflight read only /credits,
 * said "go", discovery ran and was billed to Apify and Firecrawl, and then
 * every classify call was refused. A folder of fetched companies with nothing
 * judged — money spent, no product, and the error arriving after the run
 * instead of before it.
 *
 * Two independent ceilings, and the answer is always the lower one. That is
 * the same shape as the self-imposed delta cap on the fallback key, which
 * shipped broken once already for exactly this reason.
 *
 * These stub `fetch` so the real function runs against known vendor payloads
 * rather than the network — the point is the decision, not OpenRouter's uptime.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.OPENROUTER_API_KEY ||= "sk-test-preflight";
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test";

const { openRouterRemaining, creditBlockerFor } = await import("../lib/pipeline/preflight.js");

type Payloads = {
  credits: { total_credits: number; total_usage: number };
  key?: { limit: number | null; limit_remaining: number | null };
};

const realFetch = globalThis.fetch;

/** Answer /credits and /key with the given payloads; everything else 404s. */
function stub(p: Payloads) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/credits")) {
      return new Response(JSON.stringify({ data: p.credits }), { status: 200 });
    }
    if (url.endsWith("/key")) {
      if (!p.key) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify({ data: p.key }), { status: 200 });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
}

const restore = () => {
  globalThis.fetch = realFetch;
};

test("the KEY's limit binds even when the account is flush", async () => {
  // The exact numbers from the live failure.
  stub({
    credits: { total_credits: 20, total_usage: 11.93 },
    key: { limit: 5, limit_remaining: 0 },
  });
  try {
    assert.equal(await openRouterRemaining(), 0, "$8.07 in the account must not read as spendable");
  } finally {
    restore();
  }
});

test("and the refusal happens before the run, naming the right ceiling", async () => {
  stub({
    credits: { total_credits: 20, total_usage: 11.93 },
    key: { limit: 5, limit_remaining: 0 },
  });
  try {
    const blocker = await creditBlockerFor(8);
    assert.ok(blocker, "a capped key must refuse, not proceed");
    // "Top up" is actively wrong here and sends someone to the wrong screen:
    // the account holds credit, the ceiling is a number beside the key.
    assert.match(blocker!, /spend limit/i);
    assert.match(blocker!, /dashboard/i);
    assert.doesNotMatch(blocker!, /^Not enough OpenRouter credit/);
  } finally {
    restore();
  }
});

test("an uncapped key reports limit null and must not read as zero", async () => {
  // Treating null as 0 would refuse every search on a perfectly good key.
  stub({
    credits: { total_credits: 20, total_usage: 11.93 },
    key: { limit: null, limit_remaining: null },
  });
  try {
    const left = await openRouterRemaining();
    assert.ok(left !== null && left > 8, `expected the account balance, got ${left}`);
  } finally {
    restore();
  }
});

test("a genuinely empty account still says top up, not 'raise the limit'", async () => {
  stub({
    credits: { total_credits: 5, total_usage: 5 },
    key: { limit: null, limit_remaining: null },
  });
  try {
    const blocker = await creditBlockerFor(8);
    assert.ok(blocker);
    assert.match(blocker!, /Top up/i);
  } finally {
    restore();
  }
});

test("an unreadable /key does not break the check", async () => {
  // Fails OPEN on the key endpoint: if only /credits answers we still know the
  // account balance, and an OpenRouter hiccup must not stop the product.
  stub({ credits: { total_credits: 20, total_usage: 11.93 } });
  try {
    const left = await openRouterRemaining();
    assert.ok(left !== null && left > 8, `expected the account balance, got ${left}`);
  } finally {
    restore();
  }
});
