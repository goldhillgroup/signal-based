import { test } from "node:test";
import assert from "node:assert/strict";
import { describeOpenRouterKey, describeRejectedKey, keyTail } from "../lib/openrouter-account.js";

test("a named key is shown by name and its last four characters", () => {
  const lines = describeOpenRouterKey({ label: "Signal Radar" }, "47ef");
  assert.match(lines[0], /“Signal Radar” ending …47ef/);
});

test("OpenRouter's masked auto-label is not mistaken for a name", () => {
  const lines = describeOpenRouterKey({ label: "sk-or-v1-abc...xyz" }, "9f3a");
  assert.match(lines[0], /unnamed key ending …9f3a/);
  assert.ok(!lines.join(" ").includes("abc...xyz"), "the masked label is not repeated");
});

test("it says plainly that the login email is not available, and how to tell which account it is", () => {
  const text = describeOpenRouterKey(null, "47ef").join(" ");
  assert.match(text, /does not reveal the login email/);
  assert.match(text, /openrouter\.ai\/settings\/keys/);
  assert.match(text, /ending …47ef/);
});

test("a key-level spend limit and the free tier are called out", () => {
  const text = describeOpenRouterKey({ label: "x", limit: 5, limit_remaining: 0.5, is_free_tier: true }, "abcd").join(" ");
  assert.match(text, /free tier/);
  assert.match(text, /spend limit of \$5\.00 \(\$0\.50 left\)/);
});

test("with no usable key, no tail is invented", () => {
  assert.match(describeOpenRouterKey(null, "")[0], /unnamed key\./);
  assert.equal(keyTail("25"), "");
  assert.equal(keyTail("sk-or-v1-abcdef1234"), "1234");
});

test("a rejected key is described by its length and shape, which is how '25' is spotted", () => {
  const [line] = describeRejectedKey("25");
  assert.match(line, /2 characters/);
  assert.match(line, /does not start with sk-or-/);
  assert.match(line, /about 70 characters/);
  assert.doesNotMatch(describeRejectedKey("sk-or-v1-" + "a".repeat(60))[0], /does not start/);
});
