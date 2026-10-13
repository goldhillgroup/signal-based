import { test } from "node:test";
import assert from "node:assert/strict";
import { refinementForContinuation } from "../lib/pipeline/refinement.js";

const fallback = "founder still leading with a son or daughter stepping up beside them";

test("the focus a search started with is read back from its query", () => {
  const r = refinementForContinuation({ label: "Landscaping companies in Ohio", query: "Landscaping companies in Ohio, second generation taking over", fallback });
  assert.equal(r, "second generation taking over");
});

test("a focus containing commas survives", () => {
  const r = refinementForContinuation({ label: "Landscaping companies in Ohio, Georgia", query: "Landscaping companies in Ohio, Georgia, founder retiring, son joining", fallback });
  assert.equal(r, "founder retiring, son joining");
});

test("with no focus in the query, the saved description stands in, then the default", () => {
  assert.equal(refinementForContinuation({ label: "L", query: "L", described: "my own sentence", fallback }), "my own sentence");
  assert.equal(refinementForContinuation({ label: "L", query: "L", described: "  ", fallback }), fallback);
  assert.equal(refinementForContinuation({ label: "L", query: "L", fallback }), fallback);
});

test("a renamed folder cannot be read back, so the stand-ins apply rather than a wrong focus", () => {
  const r = refinementForContinuation({ label: "Tuesday call", query: "Landscaping companies in Ohio, second generation", described: "saved", fallback });
  assert.equal(r, "saved");
});
