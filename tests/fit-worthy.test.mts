/**
 * Two gates found by reading a real folder rather than the code.
 *
 * A live run put 24 leads in a folder. Nine named no individual at all, five
 * were solo architecture studios — which the written ICP excludes by name
 * ("not lifestyle businesses or solo professional practices") — one was Hunter
 * Industries, a global irrigation manufacturer nowhere near the $5-30M band,
 * and one was called CURRENT_LIVE_SITE, scraped off a staging banner.
 *
 * Cause: stillFamilyOwned is deliberately generous — it only fails on a
 * specific reason in the text, because cutting a real family firm on a page
 * that never mentions ownership is the more expensive error. But it was the
 * ONLY family test a fit-only lead had to pass, so "the page says nothing"
 * resolved to family-owned: true and the company became a lead. Those
 * companies had not qualified; they had failed to disqualify themselves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitOnlyIsLeadWorthy, realCompanyName } from "../lib/lead-signal.js";

test("a page that says nothing at all is not a lead", () => {
  assert.equal(fitOnlyIsLeadWorthy(null, false, []), false);
  assert.equal(fitOnlyIsLeadWorthy("", false, null), false);
  // A first name is not somebody you can look up and ring.
  assert.equal(fitOnlyIsLeadWorthy("Eric", false, []), false, '"Eric" is not callable');
});

test("any ONE positive piece of evidence is enough for the weak tier", () => {
  assert.equal(fitOnlyIsLeadWorthy("Bruce Cole", false, []), true, "somebody to ring");
  assert.equal(fitOnlyIsLeadWorthy(null, true, []), true, "the company calls itself family-owned");
  assert.equal(fitOnlyIsLeadWorthy(null, false, ["growth"]), true, "a supporting signal");
});

test("the bar is LOW on purpose — this is the weakest tier, not the pair", () => {
  // Being generous here is correct: the pair has its own five traps. What this
  // refuses is only the total absence of information.
  assert.equal(fitOnlyIsLeadWorthy("Dave Brewer", false, []), true);
  assert.equal(fitOnlyIsLeadWorthy(null, false, ["legacy_language"]), true);
});

test("placeholders scraped off page furniture are refused as company names", () => {
  for (const junk of [
    "CURRENT_LIVE_SITE",
    "Untitled",
    "Home Page",
    "Your Company",
    "coming soon",
    "Under Construction",
    "WordPress site",
    "localhost",
    "https://example.com",
    "www.foo.com",
  ]) {
    assert.equal(realCompanyName(junk), false, `should refuse "${junk}"`);
  }
});

test("and an SEO-stuffed title is not a business name either", () => {
  // Straight from a real folder: 101 characters of keywords.
  assert.equal(
    realCompanyName(
      "EM Landscaping #1 Paver Installer FREE ESTIMATES 3D Designs Premium Lawn Care - We Transform Landscapes"
    ),
    false
  );
});

test("real names still pass, including awkward ones", () => {
  for (const good of [
    "Truesdale Nursery & Landscape Services",
    "CLC Landscape Design",
    "HANNIGAN HOMES, INC.",
    "Dean Allen Co.",
    "Third Generation Lawn & Landscape LLC",
    "Semco Homes",
    "R&R Landscape",
  ]) {
    assert.equal(realCompanyName(good), true, `should accept "${good}"`);
  }
});
