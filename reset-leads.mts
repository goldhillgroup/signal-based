/**
 * Empty the dashboard without making the system stupid again.
 *
 * "Start from zero" and "keep what it has learned" sound contradictory, and
 * deleting folders would genuinely destroy the second one: companies cascade
 * from searches, and those company rows ARE the intelligence.
 *
 * WHAT WOULD BE LOST BY DELETING, and why each one costs real money:
 *
 *   cross-search memory  every domain already settled is skipped by the next
 *                        search. Delete it and every future run rediscovers,
 *                        re-fetches and re-classifies ground already paid for.
 *   the recheck schedule 21 hand-audited companies are due back in 90 days
 *                        because only one generation was on the page — the
 *                        single highest-value thing in the database, and free.
 *   channel priors       measured yield per channel (web_search 38 reads per
 *                        signal, maps 98) is counted off these same rows and
 *                        decides which channel gets spent first.
 *
 * So this DETACHES rather than deletes: companies get search_id = null and the
 * folders are removed. Every query above filters on recheck_after, industry,
 * state or discovery_channel — never on search_id — so all three keep working
 * untouched. The UI only ever shows leads through a folder, so a company with
 * no folder is invisible while remaining fully known.
 *
 * Reversible in the sense that matters: nothing is destroyed. What is gone is
 * the grouping, which was only ever a label on a run.
 *
 *   npx tsx reset-leads.mts          # report only
 *   npx tsx reset-leads.mts --write  # actually reset
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    process.env[line.slice(0, i).trim()] ||= line
      .slice(i + 1)
      .trim()
      .replace(/^"|"$/g, "");
  }
}

const { createServiceRoleClient } = await import("./lib/supabase/server.js");
const sb = createServiceRoleClient();
const write = process.argv.includes("--write");

const { data: searches } = await sb.from("searches").select("id, label");
const { data: companies } = await sb
  .from("companies")
  .select("id, search_id, recheck_after, discovery_channel, status");
const all = companies ?? [];

const attached = all.filter((c) => c.search_id);
const now = new Date().toISOString();
const scheduled = all.filter((c) => c.recheck_after && c.recheck_after > now);
const channels = new Set(all.map((c) => c.discovery_channel).filter(Boolean));

console.log(`${searches?.length ?? 0} folders, ${all.length} companies (${attached.length} in a folder)\n`);
console.log("what stays, because it is what makes the next search cheap:");
console.log(`  ${all.length} domains in cross-search memory, never re-paid for`);
console.log(`  ${scheduled.length} companies scheduled to come back on their own`);
console.log(`  ${channels.size} channels with measured yield behind them`);
console.log("\nwhat goes:");
console.log(`  ${searches?.length ?? 0} folders, so the dashboard reads zero leads`);

if (!write) {
  console.log("\nDry run. Nothing changed. Re-run with --write.");
  process.exit(0);
}

// Detach FIRST. Deleting the folders while companies still point at them would
// cascade and take the companies with them — the exact loss this exists to
// avoid. Order is the whole safety property here.
const { error: detachErr } = await sb
  .from("companies")
  .update({ search_id: null })
  .not("search_id", "is", null);

if (detachErr) {
  console.error("Detach failed, nothing deleted:", detachErr.message);
  process.exit(1);
}

const { data: check } = await sb
  .from("companies")
  .select("id", { count: "exact", head: false })
  .not("search_id", "is", null);

if ((check?.length ?? 0) > 0) {
  console.error(`${check?.length} companies still attached. Refusing to delete folders.`);
  process.exit(1);
}

for (const s of searches ?? []) {
  const { error } = await sb.from("searches").delete().eq("id", s.id);
  if (error) console.warn(`  could not remove "${s.label}": ${error.message}`);
}

const { data: after } = await sb.from("searches").select("id");
const { data: kept } = await sb.from("companies").select("id");
console.log(`\nfolders now: ${after?.length ?? 0}`);
console.log(`companies kept as memory: ${kept?.length ?? 0}`);
