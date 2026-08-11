/**
 * Recover phone numbers for leads that already exist.
 *
 * New runs keep the page footer and read the number off it. This is for the
 * rows already on disk, where the footer was stripped at crawl time and the
 * number went with it.
 *
 * The gap it closes, measured across 236 qualified leads:
 *
 *   maps         108 leads   phone 81%    <- Google Places supplies it free
 *   web_search    95 leads   phone  0%
 *   hand_audit    28 leads   phone  0%
 *   directory      5 leads   phone  0%
 *
 * Web search is the channel that finds confirmed founder-and-successor pairs —
 * 4.8 per 100 companies read against Maps' 0.9 — so the leads most worth
 * ringing were exactly the ones showing no number. On a sample of 7, this
 * recovered 6.
 *
 * COSTS ONE FIRECRAWL CREDIT PER COMPANY, so it is dry-run by default and
 * prints the bill before you commit to it. Signal leads first: if the quota is
 * tight, those are the ones worth spending it on.
 *
 *   npx tsx scripts/backfill-phone.mts               # report only
 *   npx tsx scripts/backfill-phone.mts --signals     # only confirmed pairs
 *   npx tsx scripts/backfill-phone.mts --write       # apply
 *   npx tsx scripts/backfill-phone.mts --write --limit 50
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const { createServiceRoleClient } = await import("../lib/supabase/server.js");
const { firecrawlScrape } = await import("../lib/pipeline/firecrawl.js");
const { bestPhoneFor } = await import("../lib/pipeline/page-email.js");

const sb = createServiceRoleClient();
const write = process.argv.includes("--write");
const signalsOnly = process.argv.includes("--signals");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 250;

let q = sb
  .from("companies")
  .select("id, name, domain, source_url, discovery_channel, has_signal")
  .eq("status", "qualified")
  .is("phone", null)
  .limit(limit);
if (signalsOnly) q = q.eq("has_signal", true);

const { data, error } = await q;
if (error) {
  console.error(`could not read companies: ${error.message}`);
  process.exit(1);
}

const rows = (data ?? []) as {
  id: string;
  name: string;
  domain: string;
  source_url: string | null;
  discovery_channel: string | null;
  has_signal: boolean | null;
}[];

// Confirmed pairs first — if the quota runs short, spend it where it counts.
rows.sort((a, b) => Number(b.has_signal === true) - Number(a.has_signal === true));

console.log(`${rows.length} qualified leads have no phone number`);
console.log(`this will spend up to ${rows.length} Firecrawl credits (~1 per page)\n`);

if (!write) {
  const bySig = rows.filter((r) => r.has_signal === true).length;
  console.log(`  ${bySig} of them are confirmed founder-and-successor pairs`);
  console.log("\nDry run. Nothing fetched, nothing changed.");
  console.log("Re-run with --write (add --signals to do only the pairs).");
  process.exit(0);
}

let found = 0;
let missing = 0;
let unreachable = 0;

// Firecrawl's plan allows ~45 requests a minute. firecrawlScrape now waits out
// a 429 and retries, but pacing here means it rarely has to — a fixed gap is
// cheaper than a burst followed by a wall of sleeps.
const GAP_MS = 1_400;

for (const r of rows) {
  await new Promise((res) => setTimeout(res, GAP_MS));
  const url = r.source_url || `https://${r.domain}`;
  let md: string | null = null;
  try {
    md = await firecrawlScrape(url);
  } catch {
    /* treated as unreachable */
  }
  if (!md) {
    unreachable++;
    console.log(`  unreachable  ${r.name.slice(0, 38)}`);
    continue;
  }
  const phone = bestPhoneFor(md);
  if (!phone) {
    missing++;
    console.log(`  no number    ${r.name.slice(0, 38)}`);
    continue;
  }
  const { error: e } = await sb
    .from("companies")
    .update({ phone })
    // Only ever fills a blank. If a crawl set one between the read and now,
    // that came from Google Places and is better than this.
    .eq("id", r.id)
    .is("phone", null);
  if (e) {
    console.warn(`  ${r.name}: ${e.message}`);
    continue;
  }
  found++;
  console.log(`  ${phone.padEnd(15)} ${r.name.slice(0, 38).padEnd(40)} ${r.discovery_channel ?? ""}`);
}

console.log(`\n  ${found} numbers recovered`);
console.log(`  ${missing} pages genuinely have no number on them`);
console.log(`  ${unreachable} pages could not be fetched`);
