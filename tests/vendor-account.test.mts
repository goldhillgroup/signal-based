import { test } from "node:test";
import assert from "node:assert/strict";
import { accountForApify, accountForEmail, accountForOpenRouter, accountForUnknownOwner, tailOf } from "../lib/vendor-account.js";

test("OpenRouter: the user and organization IDs and the key ending", () => {
  const s = accountForOpenRouter({ creator_user_id: "user_36NFMK3YkPuYavIM1xm3L2Yw5t4", organization_id: "org_3HPuc3Tny8c52JhA5zdw4grXGd7" }, "8856");
  assert.match(s, /OpenRouter user user_36NFMK3YkPuYavIM1xm3L2Yw5t4/);
  assert.match(s, /organization org_3HPuc3Tny8c52JhA5zdw4grXGd7/);
  assert.match(s, /key ending …8856/);
});

test("Apify: email, account name, plan and key ending", () => {
  const s = accountForApify({ username: "able_quadruplet", email: "jon@thegoldhillgroup.com", profile: { name: "Goldhill Group" }, plan: { id: "STARTER" } }, "bd7L");
  assert.equal(s, "jon@thegoldhillgroup.com · account “able_quadruplet” (Goldhill Group) · Starter plan · key ending …bd7L");
});

test("an email-only vendor shows the email and the key ending", () => {
  assert.equal(accountForEmail("jon@thegoldhillgroup.com", "ab12"), "jon@thegoldhillgroup.com · key ending …ab12");
});

test("a vendor that reveals no owner says so, and shows the key ending and anything useful it does give", () => {
  assert.equal(accountForUnknownOwner("Tavily", "9z9z", "Researcher plan"), "Owner not shown by Tavily · key ending …9z9z · Researcher plan");
  assert.equal(accountForUnknownOwner("Firecrawl", "1234"), "Owner not shown by Firecrawl · key ending …1234");
});

test("a key too short to mean anything is not shown as an ending, and a missing key says so", () => {
  assert.equal(tailOf("25"), "");
  assert.equal(tailOf(null), "");
  assert.equal(tailOf("sk-or-v1-abcd1234"), "1234");
  assert.match(accountForUnknownOwner("OpenRouter", ""), /no usable key saved/);
});

test("the whole key is never part of any line", () => {
  const key = "sk-or-v1-SECRETSECRETSECRETSECRET1234";
  const all = [accountForOpenRouter(null, tailOf(key)), accountForApify(null, tailOf(key)), accountForEmail(null, tailOf(key)), accountForUnknownOwner("X", tailOf(key))].join("\n");
  assert.ok(!all.includes("SECRET"));
  assert.ok(all.includes("1234"));
});
