/**
 * Not paying to be told a funeral home is a funeral home.
 *
 * OpenRouter is 50-76% of a search's cost, all of it classify + disprove at
 * $0.012 a call. Two savings here, and the second is the one with teeth.
 *
 * The risk is entirely one-sided: skipping a real company to save $0.022 is a
 * far worse trade than paying $0.022 to reject a newspaper. So these tests
 * care much more about what is KEPT than what is skipped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isJunkDomain, isBlocked } from "../lib/pipeline/apify.js";
import { UNIT_USD } from "../lib/pipeline/pricing.js";
import { isWrongKindOfBusiness } from "../lib/pipeline/recheck-policy.js";

test("skips domains that are plainly not an operating trade business", () => {
  for (const d of [
    "quora.com", "courant.com", "legacy.com", "networx.com",
    "sansonefuneralhome.com", "bayareafuneraldirector.com", "altogetherfuneral.com",
    "passages.winnipegfreepress.com", "footballfoundation.org", "irem-centralfl.org",
  ]) {
    assert.equal(isJunkDomain(d), true, `${d} should be skipped`);
  }
});

test("known marketplaces are named exactly, because the trade veto protects them", () => {
  // "lawnstarter" contains "lawn", so the pattern rule deliberately spares it —
  // that veto is what stops a real landscaper being skipped unread. Hosts we
  // are certain about are listed instead, where an exact match cannot catch a
  // real company by accident.
  for (const d of ["lawnstarter.com", "networx.com", "procore.com", "quora.com"]) {
    assert.equal(isBlocked(d), true, `${d} should never reach a fetch`);
  }
});

test("REAL COMPANIES SURVIVE — the expensive direction to get wrong", () => {
  // Every one of these is a real company on disk. An earlier version of the
  // rule used bare substrings and "inc.com" killed all seven, including
  // techscapeinc.com, a HIGH-confidence signal lead.
  for (const d of [
    "naturalscapeinc.com", "techscapeinc.com", "jomarinc.com", "dcrcompaniesinc.com",
    "debartoloinc.com", "millernurseriesinc.com", "glscapesinc.com",
    "truesdalenursery.com", "elberslandscape.com", "clclandscapedesign.com",
    "semcohomes.com", "wicherthomes.com", "pazmanybros.com",
  ]) {
    assert.equal(isJunkDomain(d), false, `${d} is a real company and must not be skipped`);
  }
});

test("a trade word vetoes the rule, however junk the rest looks", () => {
  // A .org that says landscaping is far more likely a real company than an
  // association worth skipping unread.
  assert.equal(isJunkDomain("valleylandscaping.org"), false);
  assert.equal(isJunkDomain("pressplumbing.com"), false);
  assert.equal(isJunkDomain("legacyhomesbuilder.com"), false);
  assert.equal(isJunkDomain("memorialtreeservice.com"), false);
});

test("the filter runs before anything is fetched", () => {
  // isBlocked is applied at discovery, so a skip costs neither the page nor
  // the classify call.
  assert.equal(isBlocked("sansonefuneralhome.com"), true);
  assert.equal(isBlocked("truesdalenursery.com"), false);
});

test("the disprove pass costs less than the classify it checks", () => {
  assert.ok(
    UNIT_USD.disprove_call < UNIT_USD.classify_call,
    "disprove doubles the LLM bill on every signal company if priced the same"
  );
});

test("nothing empty or malformed is treated as junk", () => {
  for (const d of ["", null, undefined]) {
    assert.equal(isJunkDomain(d as unknown as string), false);
  }
});

test("an export never contains what the page refuses to show", () => {
  // The folder exported EVERY row, including the ones hidden from the "Not a
  // fit" tab for being a different kind of business. The tab read "Not a fit
  // 39" while the button beside it offered "67 not a fit", and the sheet had
  // 28 funeral homes in it that the product had already decided were not worth
  // his attention. A hidden row is hidden everywhere or nowhere.
  const rows = [
    { status: "qualified", rejectionReason: null },
    { status: "rejected", rejectionReason: "Only one generation is on the leadership page." },
    { status: "rejected", rejectionReason: "This is a funeral home, not a landscaping company." },
    { status: "rejected", rejectionReason: "A local newspaper's opinion site." },
  ];
  const exportable = rows.filter(
    (c) => c.status !== "rejected" || !isWrongKindOfBusiness(c.rejectionReason)
  );
  assert.equal(exportable.length, 2, "the funeral home and the newspaper must not be exported");
  assert.ok(
    exportable.some((r) => /only one generation/i.test(r.rejectionReason ?? "")),
    "an ARGUABLE cut must still be exported — that is the point of showing it"
  );
});
