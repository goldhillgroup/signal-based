import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyNote } from "../lib/folder-note.js";

test("the log line that sat on nearly every list is said plainly", () => {
  for (const raw of [
    "ran out of time before it could read another batch",
    "ran out of time before it could look for more companies",
  ]) {
    const n = friendlyNote(raw);
    assert.ok(n && /carry on/.test(n) && /saved/.test(n), n ?? "null");
    assert.ok(!/batch/.test(n!), "no pipeline vocabulary");
  }
});

test("a message already written for the client is left alone", () => {
  const sentence = "Stopped at the time limit after checking 145 companies. The 26 already found are saved and complete.";
  assert.equal(friendlyNote(sentence), sentence);
});

test("an unknown message passes through, and nothing is nothing", () => {
  assert.equal(friendlyNote("Could not search: Web search channel failed"), "Could not search: Web search channel failed");
  assert.equal(friendlyNote(null), null);
  assert.equal(friendlyNote("   "), null);
});
