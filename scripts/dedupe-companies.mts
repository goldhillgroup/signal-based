/**
 * Collapse the duplicate company rows already on file.
 *
 * WHY. The same company is stored once per folder it was found in, by design,
 * and re-checks plus "re-read everything" searches were inserting it again every
 * time (see lib/pipeline/recheck-selection.ts for the full account). On the live
 * database, 2026-10-13: 110 domains in more than one row, 14 of them as a
 * QUALIFIED lead in several lists, acmewire.com eleven times. The inserting is
 * fixed at the source; this removes what is already there.
 *
 * WHAT IT DOES, per domain that has more than one row:
 *   - leads: keeps the BEST one (a pair beats a fit, stronger confidence, one
 *     with a personal address, newest read), MOVES every address from the others
 *     onto it, carries over his note / 1-5 if the survivor has none, then
 *     removes the others
 *   - cuts: keeps ONE rejected row per domain (the one that will be reconsidered
 *     last, or never), and none at all when the company is a lead somewhere,
 *     because a lead is never re-checked
 *   - then recounts the affected searches' counters, since a continuation seeds
 *     from them
 *
 * SAFE BY DEFAULT. Without --write it changes nothing and prints the plan.
 * Deleting a company row also deletes its evidence quote (the contacts are moved
 * first), and that cannot be undone, which is why it asks.
 *
 *   npx tsx scripts/dedupe-companies.mts            # plan only
 *   npx tsx scripts/dedupe-companies.mts --write    # do it
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  if (line.trim().startsWith("#")) continue;
  // Tolerates a stray lowercase prefix on a line ("hoNEXT_PUBLIC_..."), which a
  // hand edit can leave behind.
  const m = /^(?:[a-z]+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (m) process.env[m[1]] ||= m[2].trim().replace(/^"|"$/g, "");
}

const { createServiceRoleClient } = await import("../lib/supabase/server.js");
const write = process.argv.includes("--write");
const sb = createServiceRoleClient();

interface Row {
  id: string;
  domain: string;
  search_id: string | null;
  status: string;
  has_signal: boolean | null;
  confidence: string | null;
  recheck_after: string | null;
  last_crawled_at: string | null;
  first_seen_at: string | null;
  contacts: { id: string; email: string | null; find_status: string; name_inferred: boolean; find_source: string | null }[];
}

const rows: Row[] = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await sb
    .from("companies")
    .select("id,domain,search_id,status,has_signal,confidence,recheck_after,last_crawled_at,first_seen_at,contacts(id,email,find_status,name_inferred,find_source)")
    .not("search_id", "is", null)
    .range(from, from + 499);
  if (error) {
    console.error("read failed:", error.message);
    process.exit(1);
  }
  if (!data?.length) break;
  rows.push(...(data as unknown as Row[]));
  if (data.length < 500) break;
}

const norm = (d: string) => d.trim().toLowerCase().replace(/^www\./, "");
const CONF: Record<string, number> = { high: 3, medium: 2, verify: 1 };
const hasPersonal = (r: Row) =>
  r.contacts.some((c) => c.email && c.find_status === "found" && !c.name_inferred && !String(c.find_source ?? "").includes("unmatched"));
const score = (r: Row) => [
  r.status === "qualified" ? 1 : 0,
  r.has_signal === true ? 1 : 0,
  CONF[r.confidence ?? ""] ?? 0,
  hasPersonal(r) ? 1 : 0,
  new Date(r.last_crawled_at ?? r.first_seen_at ?? 0).getTime() || 0,
];
const betterThan = (a: Row, b: Row) => {
  const x = score(a), y = score(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
// null recheck_after means "never reconsider", the strongest memory to keep.
const recheckKey = (r: Row) => (r.recheck_after === null ? Infinity : new Date(r.recheck_after).getTime());

const groups = new Map<string, Row[]>();
for (const r of rows) groups.set(norm(r.domain), [...(groups.get(norm(r.domain)) ?? []), r]);

const deleteIds: string[] = [];
const moveContacts: { id: string; to: string }[] = [];
const noteCopies: { from: string; to: string }[] = [];
const affectedSearches = new Set<string>();
let leadDupes = 0, cutDupes = 0, groupsTouched = 0;

for (const [, group] of groups) {
  if (group.length < 2) continue;
  groupsTouched++;

  const leads = group.filter((r) => r.status === "qualified");
  const cuts = group.filter((r) => r.status !== "qualified");

  if (leads.length > 0) {
    let winner = leads[0];
    for (const r of leads) if (betterThan(r, winner)) winner = r;
    const haveEmails = new Set(winner.contacts.map((c) => (c.email ?? "").toLowerCase()).filter(Boolean));
    for (const loser of leads.filter((r) => r !== winner)) {
      leadDupes++;
      deleteIds.push(loser.id);
      if (loser.search_id) affectedSearches.add(loser.search_id);
      noteCopies.push({ from: loser.id, to: winner.id });
      for (const c of loser.contacts) {
        const e = (c.email ?? "").toLowerCase();
        if (e && haveEmails.has(e)) continue; // already on the survivor
        if (e) haveEmails.add(e);
        moveContacts.push({ id: c.id, to: winner.id });
      }
    }
    // A lead is never re-checked, so its old cut rows are only noise.
    for (const r of cuts) {
      cutDupes++;
      deleteIds.push(r.id);
      if (r.search_id) affectedSearches.add(r.search_id);
    }
  } else {
    let keep = cuts[0];
    for (const r of cuts) if (recheckKey(r) > recheckKey(keep)) keep = r;
    for (const r of cuts.filter((x) => x !== keep)) {
      cutDupes++;
      deleteIds.push(r.id);
      if (r.search_id) affectedSearches.add(r.search_id);
    }
  }
}

console.log(`${rows.length} company rows in folders; ${groupsTouched} domains appear more than once.`);
console.log(`  duplicate LEAD rows to remove : ${leadDupes}`);
console.log(`  duplicate CUT rows to remove  : ${cutDupes}`);
console.log(`  contacts to move onto survivors: ${moveContacts.length}`);
console.log(`  folders whose counters will be recounted: ${affectedSearches.size}`);

if (!write) {
  console.log("\nPLAN ONLY. Nothing was changed. Re-run with --write to apply.");
  process.exit(0);
}

// ---- apply -----------------------------------------------------------------
const { loadMarks, saveMarks } = await import("../lib/lead-notes.js");
const marks = await loadMarks(sb);

// 1. addresses first, so deleting a row can never take one with it
for (const m of moveContacts) {
  const { error } = await sb.from("contacts").update({ company_id: m.to }).eq("id", m.id);
  if (error) {
    console.error(`could not move contact ${m.id}, stopping before any delete: ${error.message}`);
    process.exit(1);
  }
}
// 2. his notes and grades
for (const n of noteCopies) {
  const from = marks[n.from];
  const to = marks[n.to];
  if (from && !(to?.note) && from.note) await saveMarks(sb, n.to, { note: from.note });
  if (from && !(to?.grade) && from.grade) await saveMarks(sb, n.to, { grade: from.grade });
  await saveMarks(sb, n.from, { note: null, grade: null });
}
// 3. the duplicate rows
for (let i = 0; i < deleteIds.length; i += 100) {
  const batch = deleteIds.slice(i, i + 100);
  const { error } = await sb.from("companies").delete().in("id", batch);
  if (error) {
    console.error(`delete failed: ${error.message}`);
    process.exit(1);
  }
}
// 4. counters, recounted from the rows that are left
for (const id of affectedSearches) {
  const { data } = await sb.from("companies").select("status,has_signal,confidence").eq("search_id", id);
  const rs = data ?? [];
  const kept = rs.filter((r) => r.status === "qualified");
  const pairs = kept.filter((r) => r.has_signal);
  await sb
    .from("searches")
    .update({
      qualified_count: pairs.filter((r) => r.confidence !== "verify").length,
      verify_count: pairs.filter((r) => r.confidence === "verify").length,
      fit_only_count: kept.length - pairs.length,
      rejected_count: rs.filter((r) => r.status === "rejected").length,
    })
    .eq("id", id);
}
console.log(`\nDone. Removed ${deleteIds.length} rows, moved ${moveContacts.length} contacts, recounted ${affectedSearches.size} folders.`);
