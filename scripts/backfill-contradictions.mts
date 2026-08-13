/**
 * Fix rows that contradict themselves.
 *
 * Two rules landed after these rows were written, both found by reading a live
 * folder rather than by a test:
 *
 *   a city that names another state    "Bland Landscaping — FL, Raleigh-Durham"
 *                                      Raleigh-Durham is North Carolina. The
 *                                      state comes from the search, the city
 *                                      from the page, and nothing checked they
 *                                      agreed. He would ring a company outside
 *                                      the area he asked about.
 *
 * WHAT THIS DELIBERATELY DOES NOT TOUCH: first-name-only owners. The same
 * sweep found 42 — "Paula" of Paula's A1 Tree Removal, "Gabby" of Gabby's Tree
 * Service, "Colton", "Ray". My first version cleared them all as "not somebody
 * you can ring", and that was over-correcting: next to a phone number, "ask for
 * Paula" is exactly how a small business is actually reached. They are
 * incomplete, not wrong, and callableName already stops them counting as a
 * reachable contact or qualifying a lead on their own. Clearing them would
 * destroy real information to satisfy a rule aimed at a different problem.
 *
 * ("Erik A" is a genuinely different case — it LOOKS like a full name and is
 * not. But that is one row, not a category, and the write-time rule now catches
 * its shape going forward.)
 *
 * NOTHING IS DELETED. A contradicted city becomes empty and the state stays,
 * because the state is the ground the search actually covered.
 *
 *   npx tsx scripts/backfill-contradictions.mts          # report only
 *   npx tsx scripts/backfill-contradictions.mts --write  # apply
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const { createServiceRoleClient } = await import("../lib/supabase/server.js");

const sb = createServiceRoleClient();
const write = process.argv.includes("--write");

/** Same short list cleanCity uses — unambiguous metros only, not a gazetteer. */
const METRO_STATE: Record<string, string> = {
  raleigh: "NC", durham: "NC", charlotte: "NC", greensboro: "NC",
  atlanta: "GA", savannah: "GA", nashville: "TN", memphis: "TN",
  phoenix: "AZ", tucson: "AZ", denver: "CO", "las vegas": "NV",
  portland: "OR", seattle: "WA", chicago: "IL", detroit: "MI",
  minneapolis: "MN", milwaukee: "WI", "st. louis": "MO", "kansas city": "MO",
  "new orleans": "LA", "oklahoma city": "OK", "salt lake city": "UT",
  indianapolis: "IN", columbus: "OH", cleveland: "OH", cincinnati: "OH",
  louisville: "KY", birmingham: "AL", richmond: "VA", baltimore: "MD",
  philadelphia: "PA", pittsburgh: "PA", boston: "MA", providence: "RI",
  hartford: "CT", newark: "NJ", houston: "TX", dallas: "TX",
  austin: "TX", "san antonio": "TX", miami: "FL", orlando: "FL",
  tampa: "FL", jacksonville: "FL", "los angeles": "CA", "san diego": "CA",
  "san francisco": "CA", sacramento: "CA", "new york": "NY", buffalo: "NY",
};

function cityContradictsState(city: string | null, state: string | null): boolean {
  if (!city || !state) return false;
  const low = city.toLowerCase();
  return Object.entries(METRO_STATE).some(([metro, st]) => low.includes(metro) && st !== state);
}

const { data, error } = await sb
  .from("companies")
  .select("id, name, state, city, founder_name, next_gen_name, status");

if (error) {
  console.error(`could not read companies: ${error.message}`);
  process.exit(1);
}

type Row = {
  id: string;
  name: string;
  state: string | null;
  city: string | null;
  founder_name: string | null;
  next_gen_name: string | null;
  status: string;
};

const rows = (data ?? []) as Row[];

const badCity = rows.filter((r) => cityContradictsState(r.city, r.state));
console.log(`${rows.length} companies\n`);

console.log(`CITY NAMES ANOTHER STATE — ${badCity.length}`);
for (const r of badCity.slice(0, 15)) {
  console.log(`   ${r.name.slice(0, 34).padEnd(36)} ${r.state}  "${r.city}"  -> city cleared`);
}
if (badCity.length > 15) console.log(`   … and ${badCity.length - 15} more`);

if (badCity.length === 0) {
  console.log("\nNothing contradicts itself.");
  process.exit(0);
}

if (!write) {
  console.log("\nDry run. Nothing changed. Re-run with --write.");
  process.exit(0);
}

let cities = 0;
for (const r of badCity) {
  const { error: e } = await sb
    .from("companies")
    .update({ city: null })
    .eq("id", r.id)
    // Re-assert what was read: a fresh crawl since then was written under the
    // new rule and is worth more than this.
    .eq("city", r.city!);
  if (e) console.warn(`  ${r.name}: ${e.message}`);
  else cities++;
}

console.log(`\ncleared ${cities} contradicted cities`);
