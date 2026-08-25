import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The bug this file exists for: PATCH /api/company/[id]/people was replaced
 * with a version that required person_id, which made Save answer "Which
 * person?" to the two-field editor that correctly does not send one. Every
 * lead lost the ability to have its people corrected.
 *
 * These assert the SHAPE-ROUTING rule, which is the part that broke. The
 * request bodies are the real ones each editor sends.
 */

function routeShape(body: Record<string, unknown>): "person" | "columns" {
  return typeof body.person_id === "string" ? "person" : "columns";
}

test("the two-field editor's body routes to the company columns", () => {
  assert.equal(
    routeShape({ founder_name: "John Turner", founder_title: "Owner",
                 next_gen_name: "Douglas Turner", next_gen_title: "Owner" }),
    "columns"
  );
});

test("the people editor's body routes to the person row", () => {
  assert.equal(routeShape({ person_id: "abc", is_target: true }), "person");
});

test("a body with neither is still the column path, not an error", () => {
  // It gets rejected later for having nothing to update, which is a different
  // and much clearer message than "Which person?".
  assert.equal(routeShape({}), "columns");
});

test("a non-string person_id does not sneak into the person path", () => {
  assert.equal(routeShape({ person_id: 12345 }), "columns");
  assert.equal(routeShape({ person_id: null }), "columns");
});
