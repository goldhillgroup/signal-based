/**
 * Delete rejections that were never actually judged.
 *
 * When a vendor fails mid-run — out of credit, bad key, rate limited — the
 * per-company handler used to catch it and write a REJECTION. The company was
 * fetched and paid for, never read, and recorded as a "no". It then entered
 * cross-search memory as settled and was scheduled to be SKIPPED, so the
 * mistake compounds: the next search silently declines to look at it again.
 *
 * The code no longer does this (see VendorUnavailableError — a vendor outage
 * now stops the run and records nothing against any company). This clears the
 * rows already written, most recently 72 manufacturers across MA and CT when
 * the OpenRouter balance hit zero.
 *
 * DELETES rather than re-queues, deliberately. A row saying "could not be
 * judged" carries no information — it is not a verdict, not evidence, and not
 * a useful recheck date. Removing it returns the domain to the pool as though
 * it had never been seen, which is the truth.
 *
 *   npx tsx scripts/clear-unjudged.mts          # report only
 *   npx tsx scripts/clear-unjudged.mts --write  # apply
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

// The exact sentence the old handler wrote. Matching on the stored text rather
// than on a time window, so this stays correct whenever it is run.
const UNJUDGED = "Could not be judged automatically";

const { data, error } = await sb
  .from("companies")
  .select("id, name, domain, search_id, recheck_after")
  .eq("status", "rejected")
  .ilike("rejection_reason", `${UNJUDGED}%`);

if (error) {
  console.error(`could not read companies: ${error.message}`);
  process.exit(1);
}

const rows = (data ?? []) as { id: string; name: string; domain: string; search_id: string | null; recheck_after: string | null }[];

if (rows.length === 0) {
  console.log("No unjudged rejections. Every rejection on file is a real verdict.");
  process.exit(0);
}

console.log(`${rows.length} companies were rejected WITHOUT being judged.\n`);
console.log("Each was fetched and paid for, never read, and is currently being");
console.log("skipped by cross-search memory. Deleting returns them to the pool.\n");
for (const r of rows.slice(0, 15)) {
  console.log(`  ${r.domain.slice(0, 40).padEnd(42)} skipped until ${r.recheck_after ? String(r.recheck_after).slice(0, 10) : "FOREVER"}`);
}
if (rows.length > 15) console.log(`  ... and ${rows.length - 15} more`);

if (!write) {
  console.log("\nDry run. Nothing changed. Re-run with --write.");
  process.exit(0);
}

let deleted = 0;
for (let i = 0; i < rows.length; i += 100) {
  const ids = rows.slice(i, i + 100).map((r) => r.id);
  const { error: e } = await sb
    .from("companies")
    .delete()
    .in("id", ids)
    // Re-assert the status: if something re-judged this domain between the
    // read above and now, that verdict is real and must survive.
    .eq("status", "rejected")
    .ilike("rejection_reason", `${UNJUDGED}%`);
  if (e) console.warn(`  ${e.message}`);
  else deleted += ids.length;
}
console.log(`\ndeleted ${deleted} of ${rows.length} — those domains are searchable again`);
