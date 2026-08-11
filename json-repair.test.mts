/**
 * The classifier's JSON survives truncation.
 *
 * A model response cut by max_tokens used to lose the whole company: the
 * balancing repair closes a dangling quote into an empty key, which cannot
 * parse. Observed live on elitetreeinc.com — a real landscaping company with a
 * named owner — which was recorded as "classification failed" and thrown away.
 */
const { extractJson } = await import("./lib/pipeline/openrouter.js");

let pass = 0;
const fail: string[] = [];
function check(name: string, fn: () => void) {
  try { fn(); pass++; } catch (e) { fail.push(`${name}: ${(e as Error).message}`); }
}
function eq(a: unknown, b: unknown, what: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// The EXACT shape that failed in production, from the run log.
const TRUNCATED_KEY = `{
  "companyName": "Elite Tree Service",
  "founderName": "Matthew Jenson",
  "founderTitle": "Owner/Arborist",
  "qualifies": false,
  "industry": "landscaping",
  "confidence": null,
  "`;

check("truncated mid-key keeps every complete pair", () => {
  const r = extractJson<Record<string, unknown>>(TRUNCATED_KEY);
  eq(r.companyName, "Elite Tree Service", "companyName");
  eq(r.founderName, "Matthew Jenson", "founderName");
  eq(r.founderTitle, "Owner/Arborist", "founderTitle");
  eq(r.qualifies, false, "qualifies");
  eq(r.industry, "landscaping", "industry");
  eq(r.confidence, null, "confidence");
});

check("truncated mid-key invents nothing", () => {
  const r = extractJson<Record<string, unknown>>(TRUNCATED_KEY);
  eq(Object.keys(r).length, 6, "field count");
  if ("" in r) throw new Error('an empty-string key leaked through');
});

check("truncated mid-VALUE still works (the old path)", () => {
  const r = extractJson<Record<string, unknown>>('{"a":"one","b":"two');
  eq(r.a, "one", "a");
});

check("truncated mid-key twice over", () => {
  const r = extractJson<Record<string, unknown>>('{"a":1,"b":2,"c":3,"d');
  eq(r.a, 1, "a"); eq(r.b, 2, "b"); eq(r.c, 3, "c");
});

check("a comma inside a string is not a cut point", () => {
  const r = extractJson<Record<string, unknown>>('{"quote":"Bret, his son Tony, and his nephew","next":"x');
  eq(r.quote, "Bret, his son Tony, and his nephew", "quote");
});

check("nested object does not confuse the depth walk", () => {
  const r = extractJson<Record<string, any>>('{"a":1,"inner":{"x":9,"y":8},"tail');
  eq(r.a, 1, "a"); eq(r.inner.x, 9, "inner.x"); eq(r.inner.y, 8, "inner.y");
});

check("well-formed JSON is untouched", () => {
  const r = extractJson<Record<string, unknown>>('{"a":1,"b":"two"}');
  eq(r, { a: 1, b: "two" }, "roundtrip");
});

check("fenced JSON still works", () => {
  const r = extractJson<Record<string, unknown>>('```json\n{"a":1}\n```');
  eq(r.a, 1, "a");
});

check("genuinely unparseable still throws", () => {
  let threw = false;
  try { extractJson("not json at all, no braces"); } catch { threw = true; }
  if (!threw) throw new Error("should have thrown");
});

check("a bare opening brace throws rather than returning {}", () => {
  let threw = false;
  try { extractJson('{"'); } catch { threw = true; }
  if (!threw) throw new Error("should have thrown");
});

if (fail.length) {
  console.error(`${fail.length} FAILED:`);
  for (const f of fail) console.error("  " + f);
  process.exit(1);
}
console.log(`${pass}/${pass} json-repair assertions passed`);
