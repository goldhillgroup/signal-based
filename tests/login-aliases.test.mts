import test from "node:test";
import assert from "node:assert/strict";
import { canonicalEmail } from "../lib/login-aliases.js";

test("the two aliases resolve to the one real account", () => {
  assert.equal(canonicalEmail("jon@thegoldhillgroup.com"), "jonathan@thegoldhillgroup.com");
  assert.equal(canonicalEmail("d4nielm7@gmail.com"), "jonathan@thegoldhillgroup.com");
});

test("case and stray whitespace don't defeat the match", () => {
  assert.equal(canonicalEmail("  Jon@TheGoldhillGroup.com  "), "jonathan@thegoldhillgroup.com");
  assert.equal(canonicalEmail("D4NIELM7@GMAIL.COM"), "jonathan@thegoldhillgroup.com");
});

test("the wrong domain (no 'the') is NOT an alias", () => {
  assert.equal(canonicalEmail("jon@goldhillgroup.com"), "jon@goldhillgroup.com");
  assert.equal(canonicalEmail("jonathan@goldhillgroup.com"), "jonathan@goldhillgroup.com");
});

test("the real address and the other working account pass through unchanged", () => {
  assert.equal(canonicalEmail("jonathan@thegoldhillgroup.com"), "jonathan@thegoldhillgroup.com");
  assert.equal(canonicalEmail("thegoldhillgroup@gmail.com"), "thegoldhillgroup@gmail.com");
});

test("an unrelated address is left alone, not silently redirected", () => {
  assert.equal(canonicalEmail("someone@example.com"), "someone@example.com");
});
