/**
 * Demote succession claims that rest on a name nobody can look up.
 *
 * `callableName` now gates this at write time, so new runs are correct. This is
 * for the rows already on disk. Two of the 46 signal leads name people the page
 * never fully identified — "Francisco Sr." and "Eliseo" — and one of them is
 * marked HIGH confidence. Jonathan opens that lead expecting a founder he can
 * search for and phone, and there is no surname to search.
 *
 * DEMOTION, NOT DELETION. The company stays a qualified, family-owned fit lead:
 * the business is real and may well be worth a call. What is removed is the
 * stronger claim — the confirmed founder-and-successor pair — along with the
 * confidence grade that claim earned. The names themselves are kept exactly as
 * the page gave them, because "Francisco Sr." is still true; it simply is not a
 * confirmed pair.
 *
 *   npx tsx scripts/backfill-callable.mts          # report only
 *   npx tsx scripts/backfill-callable.mts --write  # apply
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const { createServiceRoleClient } = await import("../lib/supabase/server.js");
const { callableName } = await import("../lib/lead-signal.js");

const sb = createServiceRoleClient();
const write = process.argv.includes("--write");

const { data: rows, error } = await sb
  .from("companies")
  .select("id, name, domain, founder_name, next_gen_name, confidence, has_signal")
  .eq("status", "qualified")
  .eq("has_signal", true);

if (error) {
  console.error(`could not read companies: ${error.message}`);
  process.exit(1);
}

const signals = rows ?? [];
const demote = signals.filter(
  (c) => !callableName(c.founder_name) || !callableName(c.next_gen_name)
);

console.log(`${signals.length} signal leads on file, ${demote.length} rest on a name that cannot be looked up\n`);

for (const c of demote) {
  const bad = [
    callableName(c.founder_name) ? null : `founder "${c.founder_name}"`,
    callableName(c.next_gen_name) ? null : `next gen "${c.next_gen_name}"`,
  ].filter(Boolean);
  console.log(`  ${String(c.name).slice(0, 38).padEnd(40)} [${c.confidence}]  ${bad.join(", ")}`);
}

if (demote.length === 0) {
  console.log("Nothing to demote — every signal lead names two people who can be looked up.");
  process.exit(0);
}

console.log(
  `\n  ${demote.length} would become family-owned fit leads (kept, still qualified, no longer claiming a confirmed pair)`
);

if (!write) {
  console.log("\nDry run. Nothing changed. Re-run with --write.");
  process.exit(0);
}

let ok = 0;
for (const c of demote) {
  const { error: e } = await sb
    .from("companies")
    .update({ has_signal: false, confidence: null })
    .eq("id", c.id)
    // Re-assert what was read: if a fresh crawl re-judged this company between
    // the read above and now, that judgement was made with the gate in place
    // and is worth more than this one.
    .eq("has_signal", true);
  if (e) console.warn(`  ${c.name}: ${e.message}`);
  else ok++;
}
console.log(`\nwrote ${ok} of ${demote.length}`);
