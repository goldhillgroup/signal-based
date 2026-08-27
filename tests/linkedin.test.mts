import { test } from "node:test";
import assert from "node:assert/strict";

// slugMatches is not exported; these pin the RULE it implements, which is the
// part that was wrong and cost a false positive on the first real hit.
function slugForms(s: string): string[] {
  const base = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [...new Set([base(s.replace(/&/g, " and ")), base(s.replace(/&/g, " "))])];
}
function slugMatches(url: string, name: string): boolean {
  const m = url.match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (!m) return false;
  const got = decodeURIComponent(m[1]).toLowerCase().replace(/-+/g, "-").replace(/^-|-$/g, "");
  const drop = (t: string) => t.replace(/-(inc|llc|ltd|co|corp|company)$/g, "");
  for (const form of slugForms(name)) {
    const want = drop(form);
    const g = drop(got);
    if (g === want) return true;
    const shorter = g.length < want.length ? g : want;
    const longer = g.length < want.length ? want : g;
    if (longer.startsWith(shorter + "-") && shorter.split("-").length >= 2) return true;
  }
  return false;
}

test("the company's own page matches", () => {
  assert.ok(slugMatches("https://www.linkedin.com/company/norman-charles-construction", "Norman Charles Construction, Inc."));
  assert.ok(slugMatches("https://www.linkedin.com/company/grasshopper-gardens-inc", "Grasshopper Gardens"));
});

test("a different company with a similar name does not", () => {
  // The real false positive: Annie Hall, President at Grasshopper Garden
  // Escapes, arriving on the Grasshopper Gardens lead.
  assert.equal(slugMatches("https://www.linkedin.com/company/grasshopper-garden-escapes", "Grasshopper Gardens"), false);
  assert.equal(slugMatches("https://www.linkedin.com/company/metropolitan-contractors-inc", "Norman Charles Construction, Inc."), false);
});

test("a one-word stem never matches by prefix alone", () => {
  // "Greenway" must not claim greenway-health, a hospital software company.
  assert.equal(slugMatches("https://www.linkedin.com/company/greenway-health", "Greenway"), false);
});

test("a profile URL is not a company page", () => {
  assert.equal(slugMatches("https://www.linkedin.com/in/norm-charles-a4656324", "Norman Charles Construction"), false);
});

test("an ampersand written either way still matches", () => {
  // LinkedIn drops it: greenway-landscape-design-build. Expanding it to "and"
  // and stopping there lost a page we had already found once.
  assert.ok(slugMatches("https://www.linkedin.com/company/greenway-landscape-design-build", "Greenway Landscape Design & Build"));
  assert.ok(slugMatches("https://www.linkedin.com/company/smith-and-sons-roofing", "Smith & Sons Roofing"));
});

test("runs of hyphens in a slug are not a mismatch", () => {
  assert.ok(slugMatches("https://www.linkedin.com/company/neave-group---outdoor-solutions", "Neave Group Outdoor Solutions"));
});
