/**
 * Load the 72 hand-audited companies into the database.
 *
 * These were produced by hand before any crawler existed: every row carries a
 * verbatim quote from the company's own site, a live evidence URL, and a
 * reason when it was cut. Jonathan has already seen them — this is the list
 * the whole Phase 1 pitch scales.
 *
 * WHY THEY BELONG IN THE DATABASE RATHER THAN IN A FILE
 *
 * 1. The 28 he can call. Qualified and needs-verification rows show up in his
 *    dashboard as leads, with their evidence attached, alongside everything the
 *    crawler finds. Right now the best-evidenced leads in the project live in a
 *    JSON file he cannot open.
 *
 * 2. The 44 rejections are worth more than the acceptances. Cross-search memory
 *    skips domains already settled, so seeding them means no future search ever
 *    pays to rediscover and re-classify a company a human already ruled out.
 *
 * 3. The 26 "only one generation on the page" cuts become the engine. That is
 *    exactly the fact that changes when a son or daughter joins, and
 *    recheck-policy brings them back in 90 days at zero discovery cost. Three
 *    of them are named Two Generations Landscaping, 3 Generations Improvements
 *    and Dad and Daughter Custom Homes — cut because only ONE family member
 *    appears on the leadership page, which is the sharpest test in the set.
 *
 * Idempotent: a domain already in the database is skipped, never duplicated.
 * Safe to re-run.
 *
 *   npx tsx seed-labeled.mts          # report only, writes nothing
 *   npx tsx seed-labeled.mts --write  # actually insert
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
const { recheckAfterFor } = await import("./lib/pipeline/recheck-policy.js");

interface Row {
  company: string;
  state: string;
  hq_town: string;
  vertical: string;
  confidence: string;
  verdict: string;
  reject_reason: string;
  founder: string;
  next_gen_contact: string;
  contact_title: string;
  revenue: string;
  crews: string;
  domain: string;
  evidence_url: string;
  transition: string;
  family_evidence: string;
  notes: string;
}

const rows: Row[] = JSON.parse(fs.readFileSync("labeled72.json", "utf8"));
const write = process.argv.includes("--write");
const sb = createServiceRoleClient();

/**
 * The audit's own reason codes, restated in the wording recheck-policy.ts
 * matches on. This is the load-bearing translation: get it wrong and the 26
 * most valuable rejections either never come back or come back permanently.
 */
const REJECTION_TEXT: Record<string, string> = {
  no_founder_and_nextgen:
    "Only one generation is on the leadership page, no founder-and-next-gen pair shown together.",
  too_small: "Too small, reads below the lower bound set for this search.",
  too_big: "Too big, reads above the upper bound set for this search.",
  no_longer_family: "No longer family-owned, acquired/consolidated or the family has exited.",
};

/** The audit's verticals are prose; the pipeline has two. */
function industryOf(v: string): "landscaping" | "home_builder" {
  return /builder|construction|remodel|contractor|homes/i.test(v) ? "home_builder" : "landscaping";
}

function crewsOf(v: string): "own_crews" | "subcontract" | "mixed" | null {
  if (/direct/i.test(v)) return "own_crews";
  if (/subcontract/i.test(v)) return "subcontract";
  if (/mixed/i.test(v)) return "mixed";
  return null;
}

// Domain -> what the DATABASE currently believes about it. Presence alone is
// not enough: the point of reconciling is comparing the two verdicts.
const existing = new Map<string, { id: string; status: string; reason: string | null }>();
for (let from = 0; ; from += 1000) {
  const { data } = await sb
    .from("companies")
    .select("id, domain, status, rejection_reason")
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  data.forEach((d) => {
    if (d.domain) existing.set(d.domain, { id: d.id, status: d.status, reason: d.rejection_reason });
  });
  if (data.length < 1000) break;
}

const fresh = rows.filter((r) => r.domain && !existing.has(r.domain));
const skipped = rows.length - fresh.length;

/**
 * Domains the crawler reached first, where its verdict CONTRADICTS the audit.
 *
 * The old rule was "skip anything already present", which silently ranked the
 * machine above the person — in a script whose own header calls the audit "the
 * acceptance benchmark for the crawler". Five of the 72 had been reached by a
 * crawler run, and four of those the auditor had REJECTED were sitting in the
 * database as qualified leads.
 *
 * Only this direction is reconciled. Audit says rejected + database says lead
 * is the case that puts a company Jonathan personally threw out back on his
 * call list. The reverse — audit accepted it, the crawler cut it — is left
 * alone deliberately: the crawler reads the live site and the audit is a
 * snapshot, so a fresh rejection there is usually new information.
 */
const contradicted = rows.filter((r) => {
  if (!r.domain) return false;
  const db = existing.get(r.domain);
  if (db === undefined || r.verdict !== "REJECTED") return false;
  // Wrong verdict, OR the right verdict stored as a RAW AUDIT CODE. The codes
  // ("no_founder_and_nextgen") are the JSON's internal vocabulary; the UI
  // groups rejections by matching prose, and shows the reason verbatim on the
  // card, so a raw code both falls through to "Other" and gets printed at the
  // client. REJECTION_TEXT is the prose, and it belongs on every row.
  return db.status !== "rejected" || (db.reason !== null && db.reason in REJECTION_TEXT);
});

const counts = { qualified: 0, verify: 0, rejected: 0 };
for (const r of fresh) {
  if (r.verdict === "REJECTED") counts.rejected++;
  else if (r.verdict === "NEEDS_VERIFICATION") counts.verify++;
  else counts.qualified++;
}

console.log(`${rows.length} audited companies, ${skipped} already present, ${fresh.length} to add`);
console.log(`  ${counts.qualified} qualified · ${counts.verify} needs a check · ${counts.rejected} rejected`);

if (contradicted.length > 0) {
  console.log(`\n${contradicted.length} already in the database as a LEAD that the audit rejected:`);
  for (const r of contradicted) {
    console.log(`  ${r.company || r.domain}  (${r.domain}) — audit: REJECTED, db: ${existing.get(r.domain)!.status}`);
  }
  console.log("  these will be corrected to match the audit");
}

if (!write) {
  console.log("\nDry run. Nothing written. Re-run with --write to insert.");
  process.exit(0);
}

// Correct the contradictions BEFORE inserting, so a failure here cannot leave
// the run half-applied with new rows added and old ones still wrong.
for (const r of contradicted) {
  const db = existing.get(r.domain)!;
  const { error } = await sb
    .from("companies")
    .update({
      status: "rejected",
      rejection_reason:
        REJECTION_TEXT[r.reject_reason] ??
        db.reason ??
        "Cut by the hand audit.",
    })
    .eq("id", db.id);
  if (error) console.warn(`  could not correct ${r.domain}: ${error.message}`);
}
if (contradicted.length > 0) console.log(`corrected ${contradicted.length} to match the audit`);

// Nothing to insert means nothing to put in a folder. Without this guard a
// reconcile-only run (every domain already present, which is the normal case
// once seeded) still created an empty "Hand-audited proof list" beside the real
// one — a dead card on his dashboard for every re-run.
if (fresh.length === 0) {
  console.log("\nNothing new to insert.");
  process.exit(0);
}

// One folder, so they are visibly HIS audited list rather than a crawler run.
const { data: folder, error: folderErr } = await sb
  .from("searches")
  .insert({
    query: "Hand-audited family-business proof list",
    label: "Hand-audited proof list",
    status: "complete",
    mode: "hybrid",
    target_signals: 28,
    finished_at: new Date().toISOString(),
    // No cost: a person did this work, not the pipeline. Recording a spend
    // here would corrupt the cost-per-lead figure on Overview.
    cost_estimate_usd: 0,
    warnings:
      "Audited by hand before the crawler existed. Every row carries a verbatim quote and a live source URL.",
  })
  .select("id")
  .single();

if (folderErr || !folder) {
  console.error("Could not create the folder:", folderErr?.message);
  process.exit(1);
}

let inserted = 0;
let evidence = 0;
for (const r of fresh) {
  const rejected = r.verdict === "REJECTED";
  const reason = rejected
    ? REJECTION_TEXT[r.reject_reason] ?? `Cut by hand audit: ${r.reject_reason}`
    : null;
  // Both generations are named on these rows, which IS the signal.
  const hasSignal = !rejected;
  const confidence = rejected
    ? null
    : r.verdict === "NEEDS_VERIFICATION"
      ? "verify"
      : r.confidence === "HIGH"
        ? "high"
        : "medium";

  const { data: row, error } = await sb
    .from("companies")
    .insert({
      search_id: folder.id,
      domain: r.domain,
      name: r.company,
      industry: industryOf(r.vertical),
      state: r.state,
      city: r.hq_town || null,
      revenue_band: r.revenue || null,
      operating_model: crewsOf(r.crews),
      status: rejected ? "rejected" : "qualified",
      confidence,
      has_signal: rejected ? null : hasSignal,
      rejection_reason: reason,
      recheck_after: recheckAfterFor(rejected ? "rejected" : "qualified", reason),
      founder_name: r.founder || null,
      next_gen_name: r.next_gen_contact || null,
      next_gen_title: r.contact_title || null,
      source_url: r.evidence_url || null,
      // Not a paid channel — a person found these.
      discovery_channel: "hand_audit",
    })
    .select("id")
    .single();

  if (error || !row) {
    console.warn(`  skipped ${r.domain}: ${error?.message}`);
    continue;
  }
  inserted++;

  const quote = (r.transition || r.family_evidence || "").trim();
  if (!rejected && quote) {
    const { error: evErr } = await sb.from("signal_evidence").insert({
      company_id: row.id,
      quote: quote.slice(0, 2000),
      source_url: r.evidence_url,
      page_type: "about",
      disprove_notes: "Confirmed by hand audit, not by the model.",
    });
    if (!evErr) evidence++;
  }
}

await sb
  .from("searches")
  .update({
    companies_scanned: inserted,
    candidates_found: inserted,
    pages_fetched: inserted,
    qualified_count: fresh.filter((r) => r.verdict === "QUALIFIED_MEDIUM").length,
    verify_count: fresh.filter((r) => r.verdict === "NEEDS_VERIFICATION").length,
    fit_only_count: 0,
    rejected_count: counts.rejected,
  })
  .eq("id", folder.id);

console.log(`\ninserted ${inserted} companies, ${evidence} with a quoted evidence row`);
console.log(`folder: ${folder.id}`);
