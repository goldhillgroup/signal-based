/**
 * Strip the database back to the leads that have an email address.
 *
 * For when the list has become hard to read and you want to see only what is
 * genuinely actionable — a company with a verified address is somebody you can
 * write to today; the rest is research.
 *
 * WHAT THIS COSTS, and it is not small:
 *
 *   cross-search memory   every deleted domain is FORGOTTEN. The next search
 *                         over the same ground rediscovers it, re-fetches it
 *                         and re-classifies it, at about $0.02 a company. On
 *                         ~1,050 companies that is roughly $20 to learn again
 *                         what is already known.
 *   the recheck schedule  companies cut for having only one generation on the
 *                         page are due back automatically. Deleting them
 *                         cancels that, and they will not be looked at again
 *                         unless a future search happens to rediscover them.
 *   channel evidence      the measured yield per channel is counted off these
 *                         rows, and it is what decides where the read budget
 *                         goes. Delete the history and the split reverts to
 *                         seed numbers.
 *
 * scripts/reset-leads.mts exists for the softer version of this wish: it
 * empties the DASHBOARD by detaching companies from their folders, so the
 * screen is clear while every one of the three things above keeps working.
 * Prefer it unless you specifically want the data gone.
 *
 *   npx tsx scripts/keep-enriched-only.mts          # report only
 *   npx tsx scripts/keep-enriched-only.mts --write  # actually delete
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

const { data, error } = await sb
  .from("companies")
  .select("id, name, status, has_signal, discovery_channel, contacts(email, find_status)");

if (error) {
  console.error(`could not read companies: ${error.message}`);
  process.exit(1);
}

type Row = {
  id: string;
  name: string;
  status: string;
  has_signal: boolean | null;
  discovery_channel: string | null;
  contacts: { email: string | null; find_status: string }[];
};

const all = (data ?? []) as Row[];
const hasEmail = (c: Row) => c.contacts.some((x) => x.find_status === "found" && x.email);

const keep = all.filter(hasEmail);
const drop = all.filter((c) => !hasEmail(c));

const pct = (n: number) => `${n} (${Math.round((n / Math.max(all.length, 1)) * 100)}%)`;

console.log(`${all.length} companies in the database\n`);
console.log(`  KEEP — an email address was found      ${pct(keep.length)}`);
console.log(`  DELETE — no email address              ${pct(drop.length)}\n`);

const droppedLeads = drop.filter((c) => c.status === "qualified");
const droppedPairs = drop.filter((c) => c.has_signal === true);
const droppedHand = drop.filter((c) => c.discovery_channel === "hand_audit");

console.log("WHAT GOES WITH THEM");
console.log(`  qualified leads                        ${droppedLeads.length}`);
console.log(`  confirmed founder + successor pairs    ${droppedPairs.length}`);
console.log(`  companies from Jonathan's own list     ${droppedHand.length}`);
console.log(`  cross-search memory entries            ${drop.length}`);
console.log(`  cost to rediscover them all            ~$${(drop.length * 0.02).toFixed(2)}`);

if (droppedPairs.length > 0) {
  console.log(`\n  the pairs that would be deleted:`);
  for (const c of droppedPairs.slice(0, 12)) console.log(`     ${c.name}`);
  if (droppedPairs.length > 12) console.log(`     … and ${droppedPairs.length - 12} more`);
}

if (keep.length > 0) {
  console.log(`\nWHAT SURVIVES (${keep.length}):`);
  for (const c of keep.slice(0, 25)) {
    const e = c.contacts.find((x) => x.find_status === "found" && x.email);
    console.log(`   ${c.name.slice(0, 34).padEnd(36)} ${e?.email}`);
  }
  if (keep.length > 25) console.log(`   … and ${keep.length - 25} more`);
}

if (!write) {
  console.log(
    `\nDry run. Nothing changed.\n` +
      `Re-run with --write to delete ${drop.length} companies permanently.\n` +
      `For an empty DASHBOARD without losing the data, use scripts/reset-leads.mts instead.`
  );
  process.exit(0);
}

// Chunked: contacts and signal_evidence cascade from companies.
let deleted = 0;
for (let i = 0; i < drop.length; i += 100) {
  const ids = drop.slice(i, i + 100).map((c) => c.id);
  const { error: e } = await sb.from("companies").delete().in("id", ids);
  if (e) console.warn(`  chunk ${i}: ${e.message}`);
  else deleted += ids.length;
}
console.log(`\ndeleted ${deleted} of ${drop.length}; ${keep.length} enriched companies remain`);
