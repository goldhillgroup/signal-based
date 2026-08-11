/**
 * Lower confidence labels that were never earned.
 *
 * `earnedConfidence` gates this at write time, so new runs are correct. This is
 * for the rows already on disk. Two leads claimed HIGH — the label that tells
 * Jonathan he can act without checking — while supporting neither half of it:
 *
 *   Hewitt Garden & Design      no evidence quote at all
 *   Tommy Waters Custom Homes   quote describes only the successor's job;
 *                               nothing anywhere states he is the owner's son
 *
 * The second is the failure mode worth naming. 39 of 44 signal leads share a
 * surname between the two named people, which is exactly what a family business
 * looks like and exactly why the surname proves nothing by itself.
 *
 * NOTHING IS DELETED. The lead, both names and the quote are untouched; only
 * the badge changes, from "act on this" to "real, worth a look, check it
 * first". Hand-audited companies are exempt — they carry no quote because
 * Jonathan verified them himself rather than because evidence is missing, and
 * demoting them would tell him to re-check his own work.
 *
 *   npx tsx scripts/backfill-confidence.mts          # report only
 *   npx tsx scripts/backfill-confidence.mts --write  # apply
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const { createServiceRoleClient } = await import("../lib/supabase/server.js");
const { earnedConfidence } = await import("../lib/lead-signal.js");

const sb = createServiceRoleClient();
const write = process.argv.includes("--write");

const { data, error } = await sb
  .from("companies")
  .select("id, name, confidence, discovery_channel, founder_name, next_gen_name, signal_evidence(quote)")
  .eq("status", "qualified")
  .eq("has_signal", true);

if (error) {
  console.error(`could not read companies: ${error.message}`);
  process.exit(1);
}

const rows = (data ?? []) as unknown as {
  id: string;
  name: string;
  confidence: "high" | "medium" | "verify" | null;
  discovery_channel: string | null;
  founder_name: string | null;
  next_gen_name: string | null;
  signal_evidence: { quote: string | null }[];
}[];

const plan = rows
  .map((r) => {
    const quote = r.signal_evidence.map((e) => e.quote ?? "").find((q) => q.trim()) ?? null;
    const earned = earnedConfidence(
      r.confidence,
      quote,
      r.founder_name,
      r.next_gen_name,
      r.discovery_channel === "hand_audit"
    );
    return { ...r, quote, earned };
  })
  .filter((r) => r.earned !== r.confidence)
  // Only ever LOWERS a label. earnedConfidence returns null for a null input,
  // which is not a demotion and must not be written back over a real value.
  .filter(
    (r): r is typeof r & { earned: "high" | "medium" | "verify"; confidence: "high" | "medium" | "verify" } =>
      r.earned !== null && r.confidence !== null
  );

console.log(`${rows.length} signal leads, ${plan.length} carry a label they did not earn\n`);

for (const r of plan) {
  console.log(`  ${r.name.slice(0, 40).padEnd(42)} ${r.confidence} -> ${r.earned}`);
  console.log(`     ${r.quote ? `quote: "${r.quote.replace(/\s+/g, " ").slice(0, 78)}"` : "no evidence quote"}`);
  console.log(`     founder "${r.founder_name}" / next gen "${r.next_gen_name}"`);
}

if (plan.length === 0) {
  console.log("Nothing to change — every label is supported by its evidence.");
  process.exit(0);
}

if (!write) {
  console.log("\nDry run. Nothing changed. Re-run with --write.");
  process.exit(0);
}

let ok = 0;
for (const r of plan) {
  const { error: e } = await sb
    .from("companies")
    .update({ confidence: r.earned })
    .eq("id", r.id)
    // Re-assert what was read: a fresh crawl between the read and now was
    // judged with the gate in place and is worth more than this.
    .eq("confidence", r.confidence);
  if (e) console.warn(`  ${r.name}: ${e.message}`);
  else ok++;
}
console.log(`\nwrote ${ok} of ${plan.length}`);
