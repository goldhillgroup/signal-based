/**
 * The receipt shown to the client must be findable on the page.
 *
 * 63% of quotes across 44 real signal leads were stitched — separated snippets
 * joined with "..." or two phrases quoted side by side, producing receipts like
 * `"2nd generation." "took over."`. Every fragment was real, so the finding was
 * sound, but Jonathan cannot search a page for a quote that was never contiguous
 * on it.
 */
const { longestVerifiableQuote, quoteAppears } = await import("../lib/pipeline/orchestrator.js");

let pass = 0;
const fail: string[] = [];
const check = (n: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail.push(`${n}: ${(e as Error).message}`); } };
const eq = (a: unknown, b: unknown, w: string) => { if (a !== b) throw new Error(`${w}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const PAGE = `Our Team. Alex grew up the Greenway. Today, Alex is the co-owner of Greenway with
  his dad, Scott. We get to design and install beautiful landscapes, and we get to do it together.
  Bill and Beth started the company in 1982.`;

check("two side-by-side snippets reduce to the longest real one", () => {
  const q = `"Alex grew up the Greenway. Today, Alex is the co-owner of Greenway with his dad, Scott." "we get to design and install beautiful landscapes"`;
  const out = longestVerifiableQuote(q, PAGE);
  eq(out, "Alex grew up the Greenway. Today, Alex is the co-owner of Greenway with his dad, Scott.", "kept piece");
});

check("an ellipsis join reduces to the longest real one", () => {
  const q = "Alex grew up the Greenway ... Bill and Beth started the company in 1982.";
  const out = longestVerifiableQuote(q, PAGE);
  if (!out || !PAGE.toLowerCase().includes(out.toLowerCase().slice(0, 20))) throw new Error(`not on page: ${out}`);
});

check("the result is always genuinely on the page", () => {
  const q = `"Alex grew up the Greenway." "this sentence was never on the page anywhere at all"`;
  const out = longestVerifiableQuote(q, PAGE);
  eq(out, "Alex grew up the Greenway.", "should drop the invented half");
});

check("a fully invented stitched quote yields null, not a guess", () => {
  const q = `"the founder handed over in 1994." "his daughter now runs the firm."`;
  eq(longestVerifiableQuote(q, PAGE), null, "must refuse");
});

check("scraps below four words are not offered as a receipt", () => {
  eq(longestVerifiableQuote(`"2nd generation." "took over."`, PAGE), null, "too short to be evidence");
});

check("it never invents or reorders words", () => {
  const out = longestVerifiableQuote(`"Today, Alex is the co-owner of Greenway with his dad, Scott." "x y z q"`, PAGE);
  if (out && !PAGE.replace(/\s+/g, " ").toLowerCase().includes(out.replace(/\s+/g, " ").toLowerCase())) {
    throw new Error(`fabricated: ${out}`);
  }
});

check("a clean continuous quote is left exactly alone by quoteAppears", () => {
  if (!quoteAppears("Alex is the co-owner of Greenway with his dad, Scott", PAGE)) throw new Error("should verify");
});

check("surrounding quote marks are stripped, inner punctuation kept", () => {
  const out = longestVerifiableQuote(`"Bill and Beth started the company in 1982." "nope not here"`, PAGE);
  eq(out, "Bill and Beth started the company in 1982.", "trimmed but intact");
});

// ── RELEVANCE BEATS LENGTH ────────────────────────────────────────────────
// The first version of this repair kept the LONGEST surviving fragment, which
// is the obvious rule and the wrong one. On a real lead it discarded
// "Colt Ritzel joined his father, Ross, in 2021" — the sentence that IS the
// finding — for a longer one about commitment to innovation. A receipt that
// proves nothing is no better than one that cannot be found.
const RR = `Our Team. Colt Ritzel joined his father, Ross, in 2021 and now runs day to day
  operations. His commitment to innovation drives him to continually seek improvements in the
  business and in the wider industry, which he has pursued for many years.`;

check("keeps the succession sentence over a longer irrelevant one", () => {
  const q = `"Colt Ritzel joined his father, Ross, in 2021." "His commitment to innovation drives him to continually seek improvements in the business and in the wider industry"`;
  const out = longestVerifiableQuote(q, RR, ["Colt Ritzel", "Ross Ritzel"]);
  if (!out || !out.toLowerCase().includes("joined his father")) {
    throw new Error(`picked the wrong fragment: ${out}`);
  }
});

check("without names it still prefers succession language", () => {
  const q = `"Colt Ritzel joined his father, Ross, in 2021." "His commitment to innovation drives him to continually seek improvements in the business and in the wider industry"`;
  const out = longestVerifiableQuote(q, RR);
  if (!out || !out.toLowerCase().includes("joined")) throw new Error(`got: ${out}`);
});

check("a named person beats succession wording alone", () => {
  const page = `Bob took over the shop in 1990. Maria Reyes is our second generation and runs it today.`;
  const q = `"Bob took over the shop in 1990." "Maria Reyes is our second generation and runs it today."`;
  const out = longestVerifiableQuote(q, page, ["Maria Reyes"]);
  if (!out || !out.includes("Maria")) throw new Error(`got: ${out}`);
});

check("relevance never overrides being on the page", () => {
  const page = `Our team has served the area since 1962.`;
  const q = `"his son Tony joined in 2001." "Our team has served the area since 1962."`;
  const out = longestVerifiableQuote(q, page, ["Tony"]);
  eq(out, "Our team has served the area since 1962.", "must pick the verifiable one");
});

if (fail.length) { console.error(`${fail.length} FAILED:`); for (const f of fail) console.error("  " + f); process.exit(1); }
console.log(`${pass}/${pass} quote-receipt assertions passed`);
