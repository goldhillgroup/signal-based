/**
 * Clean the two columns that were carrying the model's hedging as if it were
 * data: revenue_band and the two title fields.
 *
 * Gated at write time now, so new runs are clean. This is for rows already on
 * disk. It never invents or rewrites — it keeps what is a real figure or a real
 * title, and empties what was only ever the model saying "I do not know".
 *
 *   npx tsx scripts/backfill-sheet.mts          # report only
 *   npx tsx scripts/backfill-sheet.mts --write  # apply
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const { createServiceRoleClient } = await import("../lib/supabase/server.js");
const { cleanRevenueBand, cleanTitle } = await import("../lib/lead-signal.js");

const sb = createServiceRoleClient();
const write = process.argv.includes("--write");

const { data } = await sb
  .from("companies")
  .select("id, name, revenue_band, founder_title, next_gen_title");
const rows = (data ?? []) as {
  id: string; name: string;
  revenue_band: string | null; founder_title: string | null; next_gen_title: string | null;
}[];

const plan: { id: string; name: string; patch: { revenue_band?: string | null; founder_title?: string | null; next_gen_title?: string | null }; notes: string[] }[] = [];
for (const r of rows) {
  const patch: { revenue_band?: string | null; founder_title?: string | null; next_gen_title?: string | null } = {};
  const notes: string[] = [];
  const rev = cleanRevenueBand(r.revenue_band);
  if (r.revenue_band && rev !== r.revenue_band) {
    patch.revenue_band = rev;
    notes.push(`revenue: "${r.revenue_band.slice(0, 42)}" -> ${rev ?? "(blank)"}`);
  }
  for (const f of ["founder_title", "next_gen_title"] as const) {
    const cur = r[f];
    const next = cleanTitle(cur);
    if (cur && next !== cur) {
      patch[f] = next;
      notes.push(`${f}: "${cur.slice(0, 42)}" -> ${next ?? "(blank)"}`);
    }
  }
  if (notes.length) plan.push({ id: r.id, name: r.name, patch, notes });
}

console.log(`${rows.length} companies, ${plan.length} carrying a value that is not what its column claims\n`);
for (const p of plan.slice(0, 14)) {
  console.log(`  ${p.name.slice(0, 34)}`);
  for (const n of p.notes) console.log(`     ${n}`);
}
if (plan.length > 14) console.log(`  … and ${plan.length - 14} more`);

if (!write) {
  console.log("\nDry run. Nothing changed. Re-run with --write.");
  process.exit(0);
}

let ok = 0;
for (const p of plan) {
  const { error } = await sb.from("companies").update(p.patch).eq("id", p.id);
  if (error) console.warn(`  ${p.name}: ${error.message}`);
  else ok++;
}
console.log(`\ncleaned ${ok} of ${plan.length}`);
