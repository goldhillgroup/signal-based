/**
 * Put leads that have no folder back into one.
 *
 * A company with `search_id = null` is invisible: folders are how the app lists
 * leads, and enrichment is folder-scoped (`/api/search/[id]/enrich`), so an
 * orphan cannot be viewed, exported or enriched from anywhere in the UI. It
 * still works perfectly as cross-search memory, which is why the state exists
 * at all — it is simply useless as a lead.
 *
 * NORMAL USE NEVER CREATES ONE. `companies.search_id` is ON DELETE CASCADE from
 * `searches`, so deleting a folder deletes its companies rather than orphaning
 * them. The rows this recovers came from a test harness that deliberately
 * detached companies before dropping its throwaway folders, to keep the
 * cross-search memory while cleaning up after itself — it kept the memory and
 * stranded 197 real leads, including all 15 machine-found founder-and-successor
 * pairs (Truesdale, Elbers, CLC, National Lawn, Semco among them).
 *
 * Groups them the way they would have arrived — one folder per vertical and
 * state — so they read like the search results they are, rather than a bucket
 * labelled "recovered".
 *
 *   npx tsx scripts/recover-orphans.mts          # report only
 *   npx tsx scripts/recover-orphans.mts --write  # apply
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const { createServiceRoleClient } = await import("../lib/supabase/server.js");
const { stateNameFor } = await import("../lib/pipeline/us-states.js");

const sb = createServiceRoleClient();
const write = process.argv.includes("--write");

const { data, error } = await sb
  .from("companies")
  .select("id, name, industry, state, status, confidence, has_signal")
  .is("search_id", null);

if (error) {
  console.error(`could not read companies: ${error.message}`);
  process.exit(1);
}

type Row = {
  id: string;
  name: string;
  industry: string | null;
  state: string | null;
  status: string;
  confidence: "high" | "medium" | "verify" | null;
  has_signal: boolean | null;
};

const orphans = (data ?? []) as Row[];
if (orphans.length === 0) {
  console.log("No orphaned companies. Every lead is in a folder.");
  process.exit(0);
}

// One folder per (vertical, state) — the shape a real search would have made.
const groups = new Map<string, Row[]>();
for (const c of orphans) {
  const key = `${c.industry ?? "landscaping"}|${c.state ?? "-"}`;
  groups.set(key, [...(groups.get(key) ?? []), c]);
}

const label = (industry: string, state: string) =>
  `${industry === "home_builder" ? "Home builder" : "Landscaping"} companies in ${
    state === "-" ? "the United States" : stateNameFor(state)
  }`;

console.log(`${orphans.length} companies have no folder — ${groups.size} folders would be created\n`);

for (const [key, rows] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const [industry, state] = key.split("|");
  const leads = rows.filter((r) => r.status === "qualified");
  const pairs = leads.filter((r) => r.has_signal === true).length;
  console.log(
    `  ${label(industry, state).padEnd(44)} ${String(rows.length).padStart(3)} companies, ` +
      `${String(leads.length).padStart(3)} leads, ${pairs} confirmed pair${pairs === 1 ? "" : "s"}`
  );
}

if (!write) {
  console.log("\nDry run. Nothing changed. Re-run with --write.");
  process.exit(0);
}

let madeFolders = 0;
let moved = 0;

for (const [key, rows] of groups) {
  const [industry, state] = key.split("|");
  const leads = rows.filter((r) => r.status === "qualified");

  // Counts have to match the rows or the folder header misreports itself.
  // Same split the UI uses: graded confidence is a lead, "verify" is its own
  // column, and no confidence at all is a fit-only result.
  const qualified = leads.filter((r) => r.confidence === "high" || r.confidence === "medium").length;
  const verify = leads.filter((r) => r.confidence === "verify").length;
  const fitOnly = leads.filter((r) => !r.confidence).length;
  const rejected = rows.length - leads.length;

  const { data: folder, error: e } = await sb
    .from("searches")
    .insert({
      query: label(industry, state),
      label: label(industry, state),
      status: "complete",
      mode: "hybrid",
      target_signals: Math.max(leads.length, 1),
      companies_scanned: rows.length,
      qualified_count: qualified,
      verify_count: verify,
      fit_only_count: fitOnly,
      rejected_count: rejected,
      candidates_found: rows.length,
      finished_at: new Date().toISOString(),
      created_by: null,
    })
    .select("id")
    .single();

  if (e || !folder) {
    console.warn(`  could not create ${label(industry, state)}: ${e?.message}`);
    continue;
  }
  madeFolders++;

  // Chunked: a 200-id `in` list is fine, a 2,000-id one is not.
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((r) => r.id);
    const { error: uErr } = await sb
      .from("companies")
      .update({ search_id: folder.id })
      .in("id", ids)
      // Only ever adopts a genuine orphan. If something claimed one between
      // the read above and now, that claim is the real one.
      .is("search_id", null);
    if (uErr) console.warn(`  ${label(industry, state)}: ${uErr.message}`);
    else moved += ids.length;
  }
  console.log(`  ${label(industry, state).padEnd(44)} ${rows.length} companies`);
}

console.log(`\ncreated ${madeFolders} folders, moved ${moved} of ${orphans.length} companies`);
