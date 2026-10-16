/**
 * The OpenRouter key was overwritten with "25" (a top-up amount typed into the key
 * box) on 2026-10-14, and every search then failed with HTTP 401.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSecret } from "../lib/settings-validate.js";

const REAL_SHAPE = "sk-or-v1-" + "a1b2c3d4".repeat(8);

test("the value that broke production is refused, and says why", () => {
  const msg = validateSecret("OPENROUTER_API_KEY", "25");
  assert.ok(msg && /only 2 characters/.test(msg) && /untouched/.test(msg), String(msg));
});

test("a short or blank value is never a key, for any vendor", () => {
  for (const k of ["OPENROUTER_API_KEY", "APIFY_TOKEN", "TAVILY_API_KEY", "FIRECRAWL_API_KEY", "ANYMAILFINDER_API_KEY", "MILLIONVERIFIER_API_KEY"]) {
    assert.ok(validateSecret(k, "25"), k);
    assert.ok(validateSecret(k, "   "), k);
    assert.ok(validateSecret(k, "$25.00"), k);
  }
});

test("pasting two lines, or a sentence, is refused", () => {
  assert.ok(validateSecret("APIFY_TOKEN", "apify_api_abcdefghijklmnop\nextra"));
  assert.ok(validateSecret("TAVILY_API_KEY", "my key is tvly-abcdefghijklmnop"));
});

test("an OpenRouter key must say what it is", () => {
  assert.ok(validateSecret("OPENROUTER_API_KEY", "a".repeat(40))?.includes("sk-or-"));
  assert.equal(validateSecret("OPENROUTER_API_KEY", REAL_SHAPE), null);
  assert.equal(validateSecret("OPENROUTER_API_KEY", `  ${REAL_SHAPE}  `), null, "surrounding whitespace is trimmed");
});

test("the other vendors' real-looking keys are accepted without guessing at their prefixes", () => {
  // Lengths of the keys that were working in production (24 to 58 characters).
  for (const [k, len] of [["ANYMAILFINDER_API_KEY", 24], ["MILLIONVERIFIER_API_KEY", 25], ["FIRECRAWL_API_KEY", 35], ["APIFY_TOKEN", 46], ["TAVILY_API_KEY", 58]] as const) {
    assert.equal(validateSecret(k, "x".repeat(len)), null, k);
  }
});
