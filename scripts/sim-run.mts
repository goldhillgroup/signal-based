/**
 * Run the REAL search pipeline against SIMULATED vendors: no credits spent.
 *
 *   npx tsx scripts/sim-run.mts                        # one pass, real-time latencies (~4 min)
 *   SCALE=0.1 TARGET=3 npx tsx scripts/sim-run.mts     # a quick, accelerated run
 *   SCENARIO=mapshang npx tsx scripts/sim-run.mts      # normal | mapsfail | mapshang | webfail | allfail | dry
 *   REPO=/path/to/another/checkout npx tsx scripts/sim-run.mts   # compare two versions of the code
 *   npx tsx scripts/sim-run.mts --clean                # remove anything a crashed run left behind
 *
 * WHAT IT IS FOR. The unit tests cover the pieces; what they cannot show is the
 * pipeline's CONTROL FLOW (does a slow channel stall the workers, what happens
 * when Maps hangs or every vendor is out of credit, does a pass end cleanly at
 * its deadline) and how many companies a pass actually reads. A live run answers
 * those too, but costs the client's money and cannot be repeated on demand. This
 * one costs nothing and can be run against any checkout, so two versions of the
 * orchestrator can be compared on identical conditions. (On 2026-10-13 it showed
 * a pass reading 64 companies become 108, and that a hung Maps call no longer
 * holds a pass.)
 *
 * WHAT IS REAL: the orchestrator, discovery merge, page-fetch layers, classifier
 *   plumbing, and the Supabase database.
 * WHAT IS FAKE: every outbound vendor call (Apify, OpenRouter, Tavily, Firecrawl
 *   and the companies' own websites) is answered here, with latencies drawn from
 *   fixed distributions and a deterministic mix of companies (3% founder-and-
 *   successor pairs, 15% fit-only, the rest cut; 12% of sites bot-blocked, 8%
 *   slow). Nothing leaves this machine except Supabase calls. The latencies are
 *   plausible, not measured: use it to COMPARE versions, not to quote seconds.
 *
 * DATABASE SAFETY. It writes to the real database, so the writes are allow-
 * listed. Reads pass through. Allowed: inserting this run's own fake companies,
 * contacts and evidence, and updating this run's own search row and rows. Every
 * other write (a real company's re-check date, the directory cache a 404 would
 * otherwise evict) is swallowed and reported as BLOCKED. Fake domains all start
 * "zz-sim-", the search is labelled "SIM TEST", and both are deleted at the end;
 * `--clean` finds them by those names if a run is killed half way.
 */
import fs from "node:fs";

const MAIN = process.cwd();
const REPO = process.env.REPO ?? MAIN;
const TAG = (process.env.TAG ?? "x").replace(/[^a-z0-9]/gi, "");
const TARGET = Number(process.env.TARGET ?? 50);
const SCALE = Number(process.env.SCALE ?? 1); // 1 = real-time latencies
const SCENARIO = process.env.SCENARIO ?? "normal"; // normal | mapsfail | mapshang | webfail | allfail | dry

for (const line of fs.readFileSync(`${MAIN}/.env.local`, "utf8").split("\n")) {
  if (line.trim().startsWith("#")) continue;
  const m = /^(?:[a-z]+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (m) process.env[m[1]] ||= m[2].trim().replace(/^"|"$/g, "");
}

const REAL_FETCH = globalThis.fetch.bind(globalThis);
const SUPA_HOST = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;
const T0 = Date.now();
const at = () => (Date.now() - T0) / 1000;


// ---------------------------------------------------------------- --clean
if (process.argv.includes("--clean")) {
  const { createServiceRoleClient } = await import(`${MAIN}/lib/supabase/server.ts`);
  const sbc = createServiceRoleClient();
  const { data: comps } = await sbc.from("companies").select("id").like("domain", "zz-sim-%");
  const ids = (comps ?? []).map((c: { id: string }) => c.id);
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    await sbc.from("contacts").delete().in("company_id", part);
    await sbc.from("signal_evidence").delete().in("company_id", part);
    await sbc.from("companies").delete().in("id", part);
  }
  await sbc.from("searches").delete().like("label", "SIM TEST%");
  console.log(`removed ${ids.length} simulated companies and any SIM TEST searches`);
  process.exit(0);
}

// ---------------------------------------------------------------- the world
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();

let nextId = 0;
const domainFor = (id: number) => `zz-sim-${TAG}-${String(id).padStart(5, "0")}.com`;
const idOf = (domain: string) => {
  const m = /^zz-sim-[a-z0-9]+-(\d{5})\.com$/i.exec(domain.replace(/^www\./, ""));
  return m ? Number(m[1]) : null;
};

const FIRST = ["Green", "Oak", "Summit", "Riverbend", "Lone Star", "Prairie", "Cedar", "Hill Country", "Bluebonnet", "Stonegate", "Heritage", "Mesquite"];
const SECOND = ["Landscape", "Lawn & Garden", "Outdoor Living", "Grounds", "Tree & Turf", "Irrigation"];
const companyName = (id: number) => `${FIRST[id % FIRST.length]} ${SECOND[Math.floor(id / FIRST.length) % SECOND.length]} ${id}`;

type Content = "pair" | "fit" | "other";
type Behaviour = "normal" | "slow" | "blocked";
function worldOf(id: number): { content: Content; behaviour: Behaviour } {
  const r = rng(id * 7919 + 13);
  const c = r();
  const b = r();
  return {
    content: c < 0.03 ? "pair" : c < 0.18 ? "fit" : "other",
    behaviour: b < 0.12 ? "blocked" : b < 0.2 ? "slow" : "normal",
  };
}

const QUOTE = (id: number) =>
  `Founded in 1985 by Tom Smith, ${companyName(id)} is now led by his son Sam Smith, who joined as Vice President in 2019`;

function pageHtml(id: number): string {
  const { content } = worldOf(id);
  const name = companyName(id);
  const filler =
    "We provide residential and commercial services across the Austin metro, including design, installation, seasonal maintenance and irrigation repair, with licensed crews and a fully equipped fleet serving homeowners, builders and property managers. ";
  const body =
    content === "pair"
      ? `<p>${QUOTE(id)}. Tom remains actively involved in the business. Dana Smith, co-owner and Sam's sister, runs operations.</p><p>We are family owned and operated, 40 employees strong.</p>`
      : content === "fit"
        ? `<p>${name} has been family owned and operated since 1992. Our owner, Mike Brown, leads a team of 40 employees.</p>`
        : `<p>${name} supplies industrial fasteners and fittings to manufacturers nationwide. Request a quote today.</p>`;
  return `<!doctype html><html><head><title>${name}</title><meta property="og:site_name" content="${name}"></head><body><h1>${name}</h1>${body}<p>${filler}${filler}</p></body></html>`;
}

function classification(id: number) {
  const { content } = worldOf(id);
  const base = {
    companyName: companyName(id),
    pageType: "about",
    otherSignals: [] as string[],
    employeeBand: "25-50",
    yearsInBusiness: 30,
    city: "Austin",
    revenueEstimate: "$5-10M (est.)",
    sizeFit: "in_band",
    operatingModel: "own_crews",
    stillFamilyOwned: true,
    operatingCountry: "us",
    rejectionReason: null as string | null,
  };
  if (content === "pair")
    return {
      ...base, qualifies: true, industry: "landscaping", confidence: "high",
      founderName: "Tom Smith", founderTitle: "Founder", nextGenName: "Sam Smith", nextGenTitle: "Vice President",
      otherPeople: [{ name: "Dana Smith", title: "Co-owner", relationship: "sister of Sam" }],
      quote: QUOTE(id), otherSignals: ["second generation"],
    };
  if (content === "fit")
    return {
      ...base, qualifies: false, industry: "landscaping", confidence: null,
      founderName: "Mike Brown", founderTitle: "Owner", nextGenName: null, nextGenTitle: null, otherPeople: [], quote: null,
    };
  return {
    ...base, qualifies: false, industry: "other", confidence: null,
    founderName: null, founderTitle: null, nextGenName: null, nextGenTitle: null, otherPeople: [], quote: null,
    rejectionReason: "Outside the landscaping/home-builder ICP, an industrial fastener supplier.",
  };
}

// ---------------------------------------------------------------- bookkeeping
const events: string[] = [];
const ev = (m: string) => events.push(`${at().toFixed(1).padStart(6)}s  ${m}`);
const classifyDone: number[] = [];
const fetchDone: number[] = [];
let webCalls = 0;
let mapsCalls = 0;
let SEARCH_ID = "";
let blockedWrites = 0;
let CLEANING = false;
const ownIds = new Set<string>(); // ids of the company rows this run inserted

const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms * SCALE);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------- the fake internet
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET")).toUpperCase();
  const u = new URL(url);

  // ---- Supabase: reads pass; writes are allow-listed
  if (u.host === SUPA_HOST) {
    if (method === "GET" || method === "HEAD") return REAL_FETCH(input as never, init);
    const table = u.pathname.split("/").filter(Boolean)[2] ?? "";
    const q = decodeURIComponent(u.search);
    const idsIn = (key: string) => {
      const m = new RegExp(`${key}=in\\.\\(([^)]*)\\)`).exec(q);
      return m ? m[1].split(",").map((x) => x.replace(/"/g, "")) : null;
    };
    const idEq = (key: string) => new RegExp(`${key}=eq\\.([0-9a-f-]{36})`).exec(q)?.[1] ?? null;
    const allOwn = (list: string[] | null) => !!list && list.length > 0 && list.every((x) => ownIds.has(x));

    let allowed = false;
    if (method === "POST" && table === "searches" && SEARCH_ID === "") allowed = true;
    else if (method === "PATCH" && table === "searches" && q.includes(`id=eq.${SEARCH_ID}`)) allowed = true;
    else if (method === "POST" && ["companies", "contacts", "signal_evidence"].includes(table)) allowed = true;
    else if (method === "PATCH" && table === "companies" && ownIds.has(idEq("id") ?? "")) allowed = true;
    else if (CLEANING && method === "DELETE") {
      if (table === "searches" && q.includes(`id=eq.${SEARCH_ID}`)) allowed = true;
      else if (table === "companies" && (allOwn(idsIn("id")) || q.includes(`zz-sim-${TAG}-`))) allowed = true;
      else if ((table === "contacts" || table === "signal_evidence") && allOwn(idsIn("company_id"))) allowed = true;
    }
    if (!allowed) {
      blockedWrites++;
      ev(`BLOCKED ${method} ${table} ${q.slice(0, 80)}`);
      return new Response(method === "DELETE" || method === "PATCH" ? null : "[]", { status: method === "POST" ? 201 : 204, headers: { "content-type": "application/json" } });
    }
    const res = await REAL_FETCH(input as never, init);
    if (method === "POST" && table === "companies" && res.ok) {
      try {
        const body = await res.clone().json();
        for (const r of Array.isArray(body) ? body : [body]) if (r?.id) ownIds.add(r.id);
      } catch { /* not JSON: nothing to track */ }
    }
    return res;
  }

  const signal = init?.signal ?? null;
  const r = rng(Math.floor(Math.random() * 1e9));

  // ---- Apify
  if (u.host === "api.apify.com") {
    if (u.pathname.includes("/users/me/limits")) return json({ data: { current: { monthlyUsageUsd: 1 } } });
    if (u.pathname.includes("google-search-scraper")) {
      const call = ++webCalls;
      ev(`web search #${call} started`);
      if (SCENARIO === "allfail") { await sleep(300, signal); ev(`web search #${call} FAILED (402)`); return json({ error: "not-enough-usage" }, 402); }
      if (SCENARIO === "webfail") { await sleep(2_000, signal); ev(`web search #${call} FAILED (400)`); return json({ error: "bad" }, 400); }
      await sleep(between(r, 12_000, 18_000), signal);
      if (SCENARIO === "dry") { ev(`web search #${call} returned 0`); return json([{ organicResults: [] }]); }
      const results = Array.from({ length: 60 }, () => {
        const id = ++nextId;
        return { url: `https://${domainFor(id)}/`, title: `${companyName(id)} | Family Owned in Austin, TX` };
      });
      ev(`web search #${call} returned ${results.length}`);
      return json([{ organicResults: results }]);
    }
    if (u.pathname.includes("crawler-google-places")) {
      const call = ++mapsCalls;
      ev(`maps #${call} started`);
      if (SCENARIO === "allfail") { await sleep(300, signal); ev(`maps #${call} FAILED (402)`); return json({ error: "not-enough-usage" }, 402); }
      if (SCENARIO === "mapsfail") { await sleep(20_000, signal); ev(`maps #${call} FAILED (400)`); return json({ error: "bad" }, 400); }
      if (SCENARIO === "mapshang") { ev(`maps #${call} HANGING`); await sleep(900_000, signal); }
      await sleep(between(r, 60_000, 80_000), signal);
      if (SCENARIO === "dry") { ev(`maps #${call} returned 0`); return json([]); }
      const places = Array.from({ length: 12 }, () => {
        const id = ++nextId;
        return { title: companyName(id), website: `https://${domainFor(id)}/`, phone: "(512) 555-0100", city: "Austin", address: "1 Main St, Austin, TX", state: "TX" };
      });
      ev(`maps #${call} returned ${places.length}`);
      return json(places);
    }
    if (u.pathname.includes("website-content-crawler")) {
      await sleep(between(r, 30_000, 40_000), signal); // the last-resort crawl of a blocked site
      return json([]);
    }
    return json([]);
  }
  if (u.host === "api.firecrawl.dev") {
    await sleep(500, signal);
    return json({ success: false, error: "blocked" }, 500);
  }
  if (u.host === "api.tavily.com") {
    await sleep(300, signal);
    return json({ results: [] });
  }

  // ---- OpenRouter
  if (u.host === "openrouter.ai") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { role: string; content: unknown }[] };
    const sys = String(
      Array.isArray(body.messages?.[0]?.content)
        ? (body.messages![0].content as { text?: string }[]).map((p) => p.text).join(" ")
        : body.messages?.[0]?.content ?? ""
    );
    const userMsg = String(body.messages?.[1]?.content ?? "");
    let content: unknown;
    if (/second reviewer/i.test(sys)) {
      await sleep(between(r, 3_000, 5_000), signal);
      content = { holds: true, revisedConfidence: "high", notes: "Checked: the relationship is stated on the page.", revisedRejectionReason: null };
    } else if (/Page URL: https?:\/\/([^/\s]+)/.test(userMsg)) {
      const host = /Page URL: https?:\/\/([^/\s]+)/.exec(userMsg)![1];
      const id = idOf(host);
      await sleep(between(r, 5_000, 10_000), signal);
      classifyDone.push(at());
      content = id ? classification(id) : classification(0);
    } else {
      await sleep(300, signal);
      content = { companies: [] };
    }
    return json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] });
  }

  // ---- the companies' own websites
  const id = idOf(u.host);
  if (id !== null) {
    const { behaviour } = worldOf(id);
    const slug = u.pathname.replace(/^\/|\/$/g, "");
    if (behaviour === "blocked") {
      await sleep(between(r, 600, 1_200), signal);
      return new Response("Forbidden", { status: 403, headers: { "content-type": "text/html" } });
    }
    if (slug !== "" && slug !== "about") {
      await sleep(between(r, 200, 500), signal);
      return new Response("Not found", { status: 404, headers: { "content-type": "text/html" } });
    }
    await sleep(behaviour === "slow" ? between(r, 3_000, 7_000) : between(r, 300, 2_000), signal);
    fetchDone.push(at());
    return new Response(pageHtml(id), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // anything else on the internet: nothing there
  await sleep(100, signal);
  return new Response("Not found", { status: 404 });
}) as typeof fetch;

// ---------------------------------------------------------------- run
const { createServiceRoleClient } = await import(`${REPO}/lib/supabase/server.ts`);
const { runSearchPipeline } = await import(`${REPO}/lib/pipeline/orchestrator.ts`);
const sb = createServiceRoleClient();

// Insert with the REAL fetch so the guard does not need to know this row yet.
const { data: row, error } = await sb
  .from("searches")
  .insert({
    query: `SIM TEST ${TAG} (ignore, deleted at the end)`,
    label: `SIM TEST ${TAG} (ignore)`,
    status: "running",
    mode: "hybrid",
    target_signals: TARGET,
    revenue_min_musd: null,
    revenue_max_musd: null,
    created_by: null,
  })
  .select("id")
  .single();
if (error || !row) {
  console.error("could not create the search row:", error?.message);
  process.exit(1);
}
SEARCH_ID = row.id;
console.log(`[${TAG}] scenario=${SCENARIO}; search ${SEARCH_ID} created; repo=${REPO}; target=${TARGET}; scale=${SCALE}`);

let status: Record<string, unknown> | null = null;
const started = Date.now();
try {
  await runSearchPipeline(SEARCH_ID, ["landscaping"], ["TX"], TARGET, "hybrid", null, { min: null, max: null }, true);
} catch (e) {
  console.error("PIPELINE THREW:", (e as Error).stack ?? e);
} finally {
  const wall = (Date.now() - started) / 1000;
  const { data: f } = await sb
    .from("searches")
    .select("status, error_message, warnings, companies_scanned, candidates_found, qualified_count, verify_count, fit_only_count, rejected_count, candidates_pool_exhausted")
    .eq("id", SEARCH_ID)
    .single();
  status = f as never;
  const { data: comps } = await sb.from("companies").select("id,status,has_signal,discovery_channel").eq("search_id", SEARCH_ID);
  const rows = (comps ?? []) as { id: string; discovery_channel: string | null }[];
  const byChannel: Record<string, number> = {};
  for (const c of rows) byChannel[String(c.discovery_channel)] = (byChannel[String(c.discovery_channel)] ?? 0) + 1;

  // what the contacts table got, before it is cleaned
  const srcCount: Record<string, number> = {};
  {
    const allIds = rows.map((c) => c.id);
    for (let i = 0; i < allIds.length; i += 100) {
      const { data: cs } = await sb.from("contacts").select("find_source,name").in("company_id", allIds.slice(i, i + 100));
      for (const c of (cs ?? []) as { find_source: string | null }[]) srcCount[String(c.find_source)] = (srcCount[String(c.find_source)] ?? 0) + 1;
    }
  }
  // cleanup: everything this run created
  CLEANING = true;
  const ids = rows.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    await sb.from("contacts").delete().in("company_id", part);
    await sb.from("signal_evidence").delete().in("company_id", part);
    await sb.from("companies").delete().in("id", part);
  }
  await sb.from("companies").delete().like("domain", `zz-sim-${TAG}-%`);
  await sb.from("searches").delete().eq("id", SEARCH_ID);
  const { count: leftover } = await sb.from("companies").select("*", { count: "exact", head: true }).like("domain", `zz-sim-${TAG}-%`);

  const per30 = (xs: number[]) => {
    const out: number[] = [];
    for (let s = 0; s < Math.ceil(wall / 30); s++) out.push(xs.filter((t) => t >= s * 30 && t < (s + 1) * 30).length);
    return out.join(" ");
  };
  console.log(`\n=== [${TAG}] RESULT (${SCENARIO}) ===`);
  console.log(`wall clock            ${wall.toFixed(1)}s`);
  console.log(`status                ${(status as { status?: string })?.status}  ${((status as { error_message?: string })?.error_message ?? "")}`);
  console.log(`candidates found      ${(status as { candidates_found?: number })?.candidates_found}`);
  console.log(`companies read        ${(status as { companies_scanned?: number })?.companies_scanned}`);
  console.log(`rows stored           ${rows.length}  (by channel ${JSON.stringify(byChannel)})`);
  console.log(`kept                  pairs ${(status as { qualified_count?: number })?.qualified_count}+${(status as { verify_count?: number })?.verify_count}, fit-only ${(status as { fit_only_count?: number })?.fit_only_count}; cut ${(status as { rejected_count?: number })?.rejected_count}`);
  console.log(`classify calls / 30s  ${per30(classifyDone)}`);
  console.log(`web searches ${webCalls}, maps ${mapsCalls}; blocked writes ${blockedWrites}; leftover sim rows after cleanup: ${leftover}`);
  console.log(`contact rows by source ${JSON.stringify(srcCount)}`);
  console.log(`warnings              ${(status as { warnings?: string })?.warnings ?? "none"}`);
  console.log(`\ntimeline (discovery):`);
  for (const e of events.filter((x) => /web search|maps/.test(x)).slice(0, 40)) console.log("  " + e);
}
process.exit(0);
