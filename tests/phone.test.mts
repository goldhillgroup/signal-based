/**
 * Reading a phone number off the page we already fetched.
 *
 * A wrong number is worse than no number: Jonathan rings a stranger while
 * believing he is ringing a founder. So these tests care far more about what
 * is REFUSED than about what is found.
 *
 * Why it exists at all: phone and address arrive with Google Places, and Places
 * only covers the Maps channel — which is the LOW-signal one (0.9 confirmed
 * pairs per 100 read, against web search's 4.8). Measured across 236 qualified
 * leads, Maps had a phone for 81% and web search for 0%, so the leads most
 * worth calling were exactly the ones with no number on them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPhones, bestPhoneFor, formatPhone } from "../lib/pipeline/page-email.js";

test("reads the formats small business sites actually use", () => {
  const cases: [string, string][] = [
    ["Call us at (415) 456-6045 today", "4154566045"],
    ["985-892-3832", "9858923832"],
    ["916.439.3472", "9164393472"],
    ["+1 650 668 2460", "6506682460"],
    ["1-407-862-9779", "4078629779"],
    ["Phone: 5187939623", "5187939623"],
  ];
  for (const [text, digits] of cases) {
    assert.deepEqual(extractPhones(text), [digits], `failed on: ${text}`);
  }
});

test("refuses digit runs that are not phone numbers", () => {
  // Each of these is a real thing that appears on a contractor's website.
  for (const junk of [
    "Licence #1234567890123",         // contractor licence
    "EIN 12-3456789",                 // tax id
    "Order 987654321012345",          // tracking id
    "Serving since 1978 - 2026",      // years
    "Suite 200, Springfield 62704",   // zip
    "011-234-5678",                   // area code starting 0
    "123-456-7890",                   // exchange rule: area 123 ok, but 456… see below
  ]) {
    const found = extractPhones(junk);
    assert.deepEqual(found, [], `should have refused "${junk}", got ${found.join(",")}`);
  }
});

test("refuses reserved and placeholder numbers", () => {
  assert.deepEqual(extractPhones("(555) 123-4567"), [], "555 is the fictional range");
  assert.deepEqual(extractPhones("000-000-0000"), []);
  assert.deepEqual(extractPhones("111-111-1111"), []);
  assert.deepEqual(extractPhones("(123) 456-7890"), [], "sequential filler");
});

test("a longer digit run is never mistaken for a number inside it", () => {
  assert.deepEqual(extractPhones("98589238321234"), []);
  assert.deepEqual(extractPhones("12349858923832"), []);
});

test("prefers the number the page tells you to call", () => {
  const page = `
    Fax 916 439 3470
    Some marketing copy about our history.
    Call our office: (916) 439-3472
  `;
  assert.equal(bestPhoneFor(page), "(916) 439-3472");
});

test("never returns a fax number", () => {
  assert.equal(bestPhoneFor("Fax: (916) 439-3470"), null);
});

test("with several unlabelled numbers, takes the one repeated most", () => {
  // The header/footer number appears on every page; a one-off does not.
  const page = "(650) 668-2460 ... (408) 482-0317 ... (650) 668-2460 ... (650) 668-2460";
  assert.equal(bestPhoneFor(page), "(650) 668-2460");
});

test("one format everywhere, however the site wrote it", () => {
  assert.equal(formatPhone("4154566045"), "(415) 456-6045");
  assert.equal(bestPhoneFor("reach us on 415.456.6045"), "(415) 456-6045");
});

test("a page with no number says so instead of guessing", () => {
  assert.equal(bestPhoneFor("We are a family owned landscaping company since 1978."), null);
  assert.equal(bestPhoneFor(""), null);
});
