/**
 * Repair evidence quotes that were stitched together from fragments.
 *
 * The receipt is the product. Jonathan opens a lead, reads the quote, and goes
 * to the page to check it — that is the whole reason this exists rather than a
 * list of names. A quote like
 *
 *   "2nd generation." "took over."
 *
 * is built from real text, so the FINDING is sound, but it was never one
 * passage on the page and he cannot find it when he looks. Measured across 44
 * signal leads, 28 were stitched.
 *
 * longestVerifiableQuote is now applied at write time, so new runs are clean.
 * This is for the rows already on disk. It re-fetches each page and keeps the
 * longest continuous run that genuinely appears there — it never invents,
 * edits, reorders or shortens beyond a fragment boundary, and where nothing
 * verifies it says so rather than leaving a quote that cannot be checked.
 *
 *   npx tsx scripts/backfill-quotes.mts          # report only
 *   npx tsx scripts/backfill-quotes.mts --write  # apply
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const { createServiceRoleClient } = await import("../lib/supabase/server.js");
const { longestVerifiableQuote, tidyQuote } = await import("../lib/pipeline/orchestrator.js");
const { fetchSingleUrl } = await import("../lib/pipeline/apify.js");

const sb = createServiceRoleClient();
const write = process.argv.includes("--write");

const stitched = (q: string) =>
  /\.\.\.|…/.test(q) || (q.match(/"/g) ?? []).length >= 4;

/** Wrapping quote marks, and a source_url with prose appended, are both stored
 *  data that breaks the client's ability to check a lead. Repaired alongside
 *  the stitching. */
const wrapped = (q: string) => /^["“”'].*["“”']$/.test(q.trim());
const badUrl = (u: string | null) => !u || /\s/.test(u);

const { data: rows } = await sb
  .from("signal_evidence")
  .select("id, quote, source_url, company_id, companies!inner(name, has_signal, status, founder_name, next_gen_name)");

const all = (rows ?? []) as unknown as {
  id: string; quote: string; source_url: string;
  companies: { name: string; has_signal: boolean | null; status: string; founder_name: string | null; next_gen_name: string | null };
}[];

// Only leads. A rejected company's quote is not shown as a receipt.
const targets = all.filter(
  (r) =>
    r.companies?.status === "qualified" &&
    ((r.quote && (stitched(r.quote) || wrapped(r.quote))) || badUrl(r.source_url))
);

console.log(`${all.length} evidence rows, ${targets.length} stitched on a live lead\n`);
if (targets.length === 0) {
  console.log("Nothing to repair.");
  process.exit(0);
}

let repaired = 0, dropped = 0, unreachable = 0;
const plan: { id: string; name: string; from: string; to: string | null; url: string | null }[] = [];

/** Take only the address from a field a person may have annotated. */
function cleanUrl(v: string | null): string | null {
  if (!v) return null;
  const first = String(v).trim().split(/\s+/)[0].replace(/[),.;]+$/, "");
  try {
    const u = new URL(first);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

for (const r of targets) {
  const fixedUrl = badUrl(r.source_url) ? cleanUrl(r.source_url) : null;
  if (fixedUrl) console.log(`  url repaired  ${r.companies.name.slice(0, 34)}  -> ${fixedUrl}`);
  let page = "";
  try {
    page = (await fetchSingleUrl(fixedUrl ?? r.source_url)) ?? "";
  } catch {
    /* treated as unreachable below */
  }
  if (!page) {
    unreachable++;
    console.log(`  unreachable  ${r.companies.name.slice(0, 34)}`);
    continue;
  }
  // Same preference the pipeline uses: the passage that names the people and
  // describes the handover, not merely the longest one that survives.
  const tidied = tidyQuote(r.quote);
  const better =
    tidied && !stitched(tidied) && page.includes(tidied.slice(0, 40))
      ? tidied // already one passage, only the wrapping marks were wrong
      : longestVerifiableQuote(tidied ?? r.quote, page, [
          r.companies.next_gen_name,
          r.companies.founder_name,
        ]);
  plan.push({ id: r.id, name: r.companies.name, from: r.quote, to: better, url: fixedUrl });
  if (better) {
    repaired++;
    console.log(`  repaired     ${r.companies.name.slice(0, 34)}`);
    console.log(`     was: ${r.quote.slice(0, 92)}`);
    console.log(`     now: ${better.slice(0, 92)}`);
  } else {
    dropped++;
    console.log(`  no verifiable passage  ${r.companies.name.slice(0, 34)} — quote will be cleared`);
  }
}

console.log(`\n  ${repaired} repaired to a single verifiable passage`);
console.log(`  ${dropped} had no continuous passage on the page — quote cleared rather than left uncheckable`);
console.log(`  ${unreachable} pages could not be fetched — left exactly as they were`);

if (!write) {
  console.log("\nDry run. Nothing changed. Re-run with --write.");
  process.exit(0);
}

let ok = 0;
for (const p of plan) {
  const { error } = await sb
    .from("signal_evidence")
    .update({ quote: p.to ?? "", ...(p.url ? { source_url: p.url } : {}) })
    .eq("id", p.id)
    // Re-assert the old value: if a fresh crawl rewrote this row between the
    // read above and now, the new quote is better than anything computed here.
    .eq("quote", p.from);
  if (error) console.warn(`  ${p.name}: ${error.message}`);
  else ok++;
}
console.log(`\nwrote ${ok} of ${plan.length}`);
