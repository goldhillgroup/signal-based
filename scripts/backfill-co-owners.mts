/**
 * Read the OTHER owners off the pages of leads that were found before co-owners
 * were captured.
 *
 * WHY. Jonathan, 2026-10-13: "Signal Radar isn't consistently capturing
 * co-owners, even when their contact information is available." New searches now
 * record every other owner a page names (see lib/pipeline/co-owners.ts), but the
 * leads already on file were classified when the model returned two people and
 * stopped. This reads each of those pages again and adds the rest.
 *
 * WHAT IT DOES, per lead (once per company, however many lists it is in):
 *   1. reads the company's own pages, FREE ONLY: a site that will not load
 *      without a paid render is skipped, not paid for
 *   2. one classifier call (about 1.1 cents) for the co-owners the page names
 *   3. adds each one as a person on the company (a name with no address yet,
 *      exactly the shape hand-added people have), skipping anyone already listed
 *   4. attributes addresses printed on the page to the right person: an address
 *      already on file that matched nobody gets its owner's name, and an address
 *      beside a co-owner's name that was never saved is added
 * It buys NO email addresses. Finding emails stays the separate, confirmed step.
 *
 * COST. About 1.1 cents per company read, billed to OpenRouter. Founder-and-
 * successor leads go first, so --limit spends on the best leads.
 *
 *   npx tsx scripts/backfill-co-owners.mts                    # plan only, free
 *   npx tsx scripts/backfill-co-owners.mts --write --limit 3  # try three first
 *   npx tsx scripts/backfill-co-owners.mts --write            # all of them
 *   --only-pairs   only leads that name a founder and a successor
 *   --again        also companies that already have co-owner rows
 *   --domain X     just that company (with --again, to read it a second time)
 *
 * SAFE TO RE-RUN. A company that already has co-owner rows, or that this script
 * has already read (recorded in backups/co-owner-backfill.json, so a company with
 * nobody else to find is not paid for twice), is skipped unless --again, and a
 * person already listed is never added twice. It stops at once if a vendor
 * reports it is out of credit.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  if (line.trim().startsWith("#")) continue;
  // Tolerates a stray lowercase prefix on a line ("hoNEXT_PUBLIC_..."), which a
  // hand edit can leave behind.
  const m = /^(?:[a-z]+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (m) process.env[m[1]] ||= m[2].trim().replace(/^"|"$/g, "");
}

const argv = process.argv.slice(2);
const write = argv.includes("--write");
const onlyPairs = argv.includes("--only-pairs");
const again = argv.includes("--again");
const limit = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) || 0 : Infinity;
const onlyDomain = argv.includes("--domain") ? argv[argv.indexOf("--domain") + 1]?.trim().toLowerCase().replace(/^www\./, "") : null;
const CENTS_PER_CALL = 1.1; // measured: $0.0109 on a real classify call, 2026-10-13
const CONCURRENCY = 5;

const { createServiceRoleClient } = await import("../lib/supabase/server.js");
const { fetchCompanyPages, pickBestPage } = await import("../lib/pipeline/apify.js");
const { classifySignal, VendorUnavailableError } = await import("../lib/pipeline/openrouter.js");
const { buildClassifyText } = await import("../lib/pipeline/orchestrator.js");
const { cleanOtherPeople, titleFor, PAGE_PERSON_SOURCE } = await import("../lib/pipeline/co-owners.js");
const { allEmailsFor, extractEmails } = await import("../lib/pipeline/page-email.js");
const { cleanTitle } = await import("../lib/lead-signal.js");

const sb = createServiceRoleClient();

interface ContactLite {
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  find_status: string;
  find_source: string | null;
}
interface Row {
  id: string;
  domain: string;
  name: string;
  search_id: string | null;
  has_signal: boolean | null;
  confidence: string | null;
  last_crawled_at: string | null;
  founder_name: string | null;
  founder_title: string | null;
  next_gen_name: string | null;
  next_gen_title: string | null;
  contacts: ContactLite[];
}

// ---- read every lead that is in a folder, a page at a time ------------------
const rows: Row[] = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await sb
    .from("companies")
    .select(
      "id,domain,name,search_id,has_signal,confidence,last_crawled_at,founder_name,founder_title,next_gen_name,next_gen_title,contacts(id,name,title,email,find_status,find_source)"
    )
    .eq("status", "qualified")
    .not("search_id", "is", null)
    .order("id")
    .range(from, from + 499);
  if (error) {
    console.error("read failed:", error.message);
    process.exit(1);
  }
  const page = (data ?? []) as unknown as Row[];
  rows.push(...page);
  if (page.length < 500) break;
}

// ---- one row per company: the strongest ------------------------------------
const norm = (d: string) => d.trim().toLowerCase().replace(/^www\./, "");
const CONF: Record<string, number> = { high: 3, medium: 2, verify: 1 };
const rank = (r: Row) => [r.has_signal ? 1 : 0, CONF[r.confidence ?? ""] ?? 0, new Date(r.last_crawled_at ?? 0).getTime() || 0];
const byDomain = new Map<string, Row>();
for (const r of rows) {
  const k = norm(r.domain);
  const cur = byDomain.get(k);
  if (!cur) {
    byDomain.set(k, r);
    continue;
  }
  const a = rank(r);
  const b = rank(cur);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (a[i] > b[i]) byDomain.set(k, r);
      break;
    }
  }
}
const companies = [...byDomain.values()];

// What this script has already read, kept beside the other row backups (gitignored).
const PROGRESS_FILE = "backups/co-owner-backfill.json";
const readBefore: Record<string, string> = fs.existsSync(PROGRESS_FILE) ? JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")) : {};
const rememberRead = (domain: string) => {
  readBefore[norm(domain)] = new Date().toISOString();
  fs.mkdirSync("backups", { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(readBefore, null, 2));
};

const alreadyDone = (r: Row) => r.contacts.some((c) => c.find_source === PAGE_PERSON_SOURCE) || norm(r.domain) in readBefore;
let todo = companies.filter(
  (r) => (again || !alreadyDone(r)) && (!onlyPairs || r.has_signal) && (!onlyDomain || norm(r.domain) === onlyDomain)
);
// Pairs first, then by strength, so --limit spends on the best leads.
todo.sort((a, b) => {
  const x = rank(a);
  const y = rank(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return 0;
});
todo = todo.slice(0, limit);

console.log(`${rows.length} leads in folders, ${companies.length} different companies.`);
console.log(`  already read or done       : ${companies.filter(alreadyDone).length}`);
console.log(`  to read now                : ${todo.length}${onlyPairs ? " (founder-and-successor leads only)" : ""}`);
console.log(`  estimated cost             : about $${((todo.length * CENTS_PER_CALL) / 100).toFixed(2)} (one classifier call each; pages are read free-only)`);
if (!write) {
  console.log("\nPLAN ONLY. Nothing was read and nothing was spent. Re-run with --write (try --limit 3 first).");
  process.exit(0);
}

// ---- do it -------------------------------------------------------------------
type Outcome =
  | { kind: "done"; added: string[]; attributed: number }
  | { kind: "skipped"; why: string }
  | { kind: "failed"; why: string };

let stopAll: string | null = null;

async function one(r: Row): Promise<Outcome> {
  if (stopAll) return { kind: "skipped", why: "stopped" };

  const pages = (await fetchCompanyPages([r.domain], { freeOnly: true })).get(r.domain) ?? [];
  const page = pickBestPage(pages);
  if (!page || page.text.length < 500) return { kind: "skipped", why: "the site would not load for free" };
  const text = buildClassifyText(page, pages);

  let result;
  try {
    result = await classifySignal(r.name, page.url, text, null);
  } catch (e) {
    if (e instanceof VendorUnavailableError) {
      stopAll = (e as Error).message;
      return { kind: "failed", why: stopAll };
    }
    return { kind: "failed", why: `could not be judged (${(e as Error).message.slice(0, 80)})` };
  }

  const named = r.contacts.filter((c) => c.name);
  const coOwners = cleanOtherPeople(result.otherPeople, [r.founder_name, r.next_gen_name, ...named.map((c) => c.name)]);
  const roster = [
    { name: r.next_gen_name, title: cleanTitle(r.next_gen_title) },
    { name: r.founder_name, title: cleanTitle(r.founder_title) },
    ...named.map((c) => ({ name: c.name, title: c.title })),
    ...coOwners.map((c) => ({ name: c.name, title: c.title })),
  ];

  // Addresses printed on the page, attributed. Only the ones that matched a
  // person the old read could not have known about.
  const newNames = new Set(coOwners.map((c) => c.name.trim().toLowerCase()));
  const found = allEmailsFor(extractEmails(text), r.domain, roster.map((p) => p.name)).slice(0, 8);
  let attributed = 0;
  for (const f of found) {
    if (!f.matchedName || !newNames.has(f.matchedName.trim().toLowerCase())) continue;
    const existing = r.contacts.find((c) => (c.email ?? "").toLowerCase() === f.email.toLowerCase());
    if (existing) {
      if (existing.name) continue; // already attributed to somebody
      const { error } = await sb
        .from("contacts")
        .update({
          name: f.matchedName,
          name_inferred: true,
          title: titleFor(f.matchedName, roster),
          find_source: `company-page:${f.kind}`,
        })
        .eq("id", existing.id);
      if (!error) attributed++;
    } else {
      const { error } = await sb.from("contacts").insert({
        company_id: r.id,
        email: f.email,
        name: f.matchedName,
        name_inferred: true,
        title: titleFor(f.matchedName, roster),
        find_status: "not_attempted",
        find_source: `company-page:${f.kind}`,
        verification_status: "not_attempted",
      });
      if (!error) attributed++;
    }
  }

  if (coOwners.length > 0) {
    const { error } = await sb.from("contacts").insert(
      coOwners.map((c) => ({
        company_id: r.id,
        name: c.name,
        title: c.title,
        email: null,
        name_inferred: false,
        find_status: "not_attempted",
        find_source: PAGE_PERSON_SOURCE,
        verification_status: "not_attempted",
      }))
    );
    if (error) return { kind: "failed", why: `could not save: ${error.message.slice(0, 80)}` };
  }
  // Read, whether or not anybody else was named, so a re-run does not pay again.
  rememberRead(r.domain);
  return { kind: "done", added: coOwners.map((c) => `${c.name}${c.title ? ` (${c.title})` : ""}`), attributed };
}

let next = 0;
const outcomes: { domain: string; o: Outcome }[] = [];
let calls = 0;
async function worker() {
  while (next < todo.length && !stopAll) {
    const r = todo[next++];
    const o = await one(r).catch((e) => ({ kind: "failed", why: String((e as Error).message).slice(0, 100) }) as Outcome);
    if (o.kind === "done") calls++;
    outcomes.push({ domain: r.domain, o });
    const line =
      o.kind === "done"
        ? o.added.length > 0
          ? `+${o.added.length}: ${o.added.join("; ")}${o.attributed ? `  [${o.attributed} address${o.attributed === 1 ? "" : "es"} attributed]` : ""}`
          : "nobody else named"
        : `${o.kind}: ${o.why}`;
    console.log(`${String(outcomes.length).padStart(3)}/${todo.length}  ${r.domain.padEnd(36)} ${line}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

const done = outcomes.filter((x) => x.o.kind === "done") as { domain: string; o: Extract<Outcome, { kind: "done" }> }[];
const withNew = done.filter((x) => x.o.added.length > 0);
console.log(`\nRead ${done.length} companies; ${withNew.length} had other owners named (${withNew.reduce((n, x) => n + x.o.added.length, 0)} people added, ${done.reduce((n, x) => n + x.o.attributed, 0)} addresses attributed).`);
console.log(`Skipped ${outcomes.filter((x) => x.o.kind === "skipped").length} (site would not load for free); failed ${outcomes.filter((x) => x.o.kind === "failed").length}.`);
console.log(`Spend: about $${((calls * CENTS_PER_CALL) / 100).toFixed(2)} (${calls} classifier calls).`);
if (stopAll) console.log(`\nSTOPPED EARLY: ${stopAll}`);
