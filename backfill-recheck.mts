/**
 * Give back the recheck dates that were never written.
 *
 * A rejected company carries `recheck_after`: the date the crawler is allowed
 * to reconsider it. The cross-search memory preload reads NULL as PERMANENT, so
 * a rejection written without one is a company excluded from every future
 * search forever.
 *
 * Two separate bugs put rows in that state, both since fixed at the source:
 *
 *   - the orchestrator's WRONG-TRADE branch was the only one of its five
 *     rejection paths that omitted recheck_after. That is the reason most
 *     likely to stop being true — a supplier adds install crews, a fence
 *     contractor moves into landscaping — and it was the one made permanent.
 *   - seed-labeled's reconcile flipped rows to rejected with status and reason
 *     but no date.
 *
 * Fixing the writers does nothing for rows already on disk. This is the
 * backfill, and it is deliberately conservative: it only ever fills a NULL, and
 * only where the CURRENT policy says the rejection is reconsiderable at all.
 * recheckAfterFor returns null for reasons that should stay permanent (a
 * directory, a marketplace, not a real trading company), and those are left
 * exactly as they are.
 *
 *   npx tsx backfill-recheck.mts          # report only
 *   npx tsx backfill-recheck.mts --write  # actually fill them
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
const { recheckAfterFor, rejectionScope } = await import("./lib/pipeline/recheck-policy.js");

const sb = createServiceRoleClient();
const write = process.argv.includes("--write");

const rows: { id: string; name: string; rejection_reason: string | null }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from("companies")
    .select("id, name, rejection_reason")
    .eq("status", "rejected")
    .is("recheck_after", null)
    .range(from, from + 999);
  if (error) {
    console.error("read failed:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  rows.push(...data);
  if (data.length < 1000) break;
}

console.log(`${rows.length} rejected companies have no recheck date\n`);

const fillable: { id: string; name: string; when: string; scope: string }[] = [];
const permanent: { name: string; reason: string }[] = [];

for (const r of rows) {
  const when = recheckAfterFor("rejected", r.rejection_reason);
  if (when) {
    fillable.push({
      id: r.id,
      name: r.name,
      when: when.slice(0, 10),
      scope: rejectionScope(r.rejection_reason),
    });
  } else {
    permanent.push({ name: r.name, reason: (r.rejection_reason ?? "").slice(0, 60) });
  }
}

// Grouped by the date the policy assigns, because the DISTRIBUTION is the
// check: a backfill that gives every row the same date means the reasons are
// not being read, and a backfill that gives none of them a date means the
// policy patterns no longer match what the pipeline writes.
const byWhen = new Map<string, number>();
for (const f of fillable) byWhen.set(`${f.when} (${f.scope})`, (byWhen.get(`${f.when} (${f.scope})`) ?? 0) + 1);

console.log(`${fillable.length} will get a date:`);
for (const [k, n] of [...byWhen.entries()].sort()) console.log(`  ${k.padEnd(28)} ${n}`);

if (permanent.length > 0) {
  console.log(`\n${permanent.length} stay permanent, which is correct for their reason:`);
  for (const p of permanent.slice(0, 8)) console.log(`  ${p.name.slice(0, 34).padEnd(36)} ${p.reason}`);
  if (permanent.length > 8) console.log(`  … and ${permanent.length - 8} more`);
}

if (!write) {
  console.log("\nDry run. Nothing changed. Re-run with --write.");
  process.exit(0);
}

let ok = 0;
for (const f of fillable) {
  const { error } = await sb
    .from("companies")
    .update({ recheck_after: new Date(`${f.when}T00:00:00.000Z`).toISOString() })
    .eq("id", f.id)
    // Re-assert both conditions. Between the read above and this write the row
    // may have been re-crawled and re-decided; without this the backfill would
    // overwrite a fresh verdict with a stale one.
    .eq("status", "rejected")
    .is("recheck_after", null);
  if (error) console.warn(`  ${f.name}: ${error.message}`);
  else ok++;
}
console.log(`\nfilled ${ok} of ${fillable.length}`);
