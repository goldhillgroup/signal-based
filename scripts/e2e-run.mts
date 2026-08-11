/**
 * End-to-end: run the real pipeline against the real vendors, then grade what
 * came back on the thing that actually matters — is the DATA THERE.
 *
 * Not a unit test and not a substitute for one. The unit suites already cover
 * the gates, the band parsing, the recheck scoping and the schedule arithmetic
 * in isolation. What none of them can tell you is whether a lead that reaches
 * the client's screen has a founder, a successor, a verbatim quote, and a live
 * URL that quote can be checked against — which is the entire deliverable.
 *
 * Costs real money. Each run is ~$0.06 per company read, so a target of 3 is
 * roughly $0.25. It prints the spend it caused.
 *
 *   npx tsx e2e-run.mts                    # one run, landscaping/NY, target 3
 *   npx tsx e2e-run.mts --runs 3           # three different configurations
 *   npx tsx e2e-run.mts --keep             # leave the folders on the dashboard
 *
 * Without --keep the folders are DETACHED and removed at the end, exactly the
 * way reset-leads.mts does it: the companies stay as cross-search memory (so
 * the test does not make the next real search re-pay for ground it covered),
 * and only the folder rows go.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trim().startsWith("#")) {
    process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const { createServiceRoleClient } = await import("../lib/supabase/server.js");
const { runSearchPipeline } = await import("../lib/pipeline/orchestrator.js");

const sb = createServiceRoleClient();
const argv = process.argv.slice(2);
const runs = Math.max(1, Number(argv[argv.indexOf("--runs") + 1]) || (argv.includes("--runs") ? 1 : 1));
const keep = argv.includes("--keep");

interface Config {
  label: string;
  industry: "landscaping" | "home_builder";
  states: string[];
  target: number;
  mode: "hybrid" | "signal" | "filter";
  refinement: string | null;
  band: { min: number | null; max: number | null };
}

// Deliberately DIFFERENT shapes, not the same run three times. Each exercises a
// path the others do not: multi-state fan-out, signal-only mode (which counts
// differently and can exhaust its pool), and a band gate with a refinement.
const CONFIGS: Config[] = [
  {
    label: "E2E 1 · landscaping · NY · hybrid",
    industry: "landscaping",
    states: ["NY"],
    target: 3,
    mode: "hybrid",
    refinement: null,
    band: { min: null, max: null },
  },
  {
    label: "E2E 2 · home builders · TX+FL · signal only",
    industry: "home_builder",
    states: ["TX", "FL"],
    target: 3,
    mode: "signal",
    refinement: "founder retiring",
    band: { min: null, max: null },
  },
  {
    label: "E2E 3 · landscaping · CA · band $3-15M",
    industry: "landscaping",
    states: ["CA"],
    target: 3,
    mode: "hybrid",
    refinement: "second generation taking over",
    band: { min: 3, max: 15 },
  },
];

/** Every field a lead needs before it is worth putting in front of the client. */
function gradeLead(c: Record<string, unknown>, ev: Record<string, unknown> | undefined) {
  const has = (v: unknown) => {
    if (v === null || v === undefined) return false;
    const t = String(v).trim();
    return t.length > 1 && !/^(-+|n\/?a|none|null|unknown|not stated)$/i.test(t);
  };
  return {
    name: has(c.name),
    domain: has(c.domain),
    state: has(c.state),
    city: has(c.city),
    founder: has(c.founder_name),
    nextGen: has(c.next_gen_name),
    quote: has(ev?.quote),
    sourceUrl: has(ev?.source_url ?? c.source_url),
    revenue: has(c.revenue_band),
    crews: has(c.operating_model) && c.operating_model !== "unknown",
    channel: has(c.discovery_channel),
  };
}

const created: string[] = [];
let grandTotal = 0;

for (let i = 0; i < Math.min(runs, CONFIGS.length); i++) {
  const cfg = CONFIGS[i];
  console.log(`\n${"═".repeat(78)}\n${cfg.label}\n${"═".repeat(78)}`);

  const { data: row, error } = await sb
    .from("searches")
    .insert({
      query: `${cfg.industry} in ${cfg.states.join(", ")}`,
      label: cfg.label,
      status: "running",
      mode: cfg.mode,
      target_signals: cfg.target,
      revenue_min_musd: cfg.band.min,
      revenue_max_musd: cfg.band.max,
      created_by: null,
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error("  could not create the folder:", error?.message);
    continue;
  }
  created.push(row.id);

  const started = Date.now();
  try {
    await runSearchPipeline(
      row.id,
      cfg.industry,
      cfg.states,
      cfg.target,
      cfg.mode,
      cfg.refinement,
      cfg.band
    );
  } catch (e) {
    console.error("  PIPELINE THREW:", (e as Error).message);
  }
  const secs = (Date.now() - started) / 1000;

  const { data: f } = await sb
    .from("searches")
    .select(
      "status, error_message, warnings, companies_scanned, pages_fetched, candidates_found, qualified_count, verify_count, fit_only_count, rejected_count, cost_estimate_usd, cost_breakdown, candidates_pool_exhausted"
    )
    .eq("id", row.id)
    .single();

  const { data: comps } = await sb
    .from("companies")
    .select("*, signal_evidence(*)")
    .eq("search_id", row.id);

  // PostgREST's generated types collapse an unknown select to `never`; this is
  // a scratch harness, not app code, so a single widening cast at the boundary
  // beats threading a row interface through it.
  const all = (comps ?? []) as unknown as Record<string, unknown>[];
  const leads = all.filter((c) => c.status === "qualified");
  const cut = all.filter((c) => c.status === "rejected");
  const cost = f?.cost_estimate_usd ?? 0;
  grandTotal += cost;

  console.log(`  status            ${f?.status}${f?.error_message ? "  ERROR: " + f.error_message : ""}`);
  console.log(`  wall clock        ${secs.toFixed(1)}s`);
  console.log(`  candidates        ${f?.candidates_found}  ->  read ${f?.companies_scanned}  (pages ${f?.pages_fetched})`);
  console.log(`  kept              ${leads.length}  (signal ${f?.qualified_count}+${f?.verify_count}, fit-only ${f?.fit_only_count})`);
  console.log(`  cut               ${cut.length}`);
  console.log(`  cost              $${cost.toFixed(4)}   ($${leads.length ? (cost / leads.length).toFixed(4) : "—"} per lead)`);
  if (f?.candidates_pool_exhausted) console.log(`  NOTE              candidate pool exhausted`);
  if (f?.warnings) console.log(`  warnings          ${f.warnings}`);
  if (f?.cost_breakdown) console.log(`  breakdown         ${f.cost_breakdown}`);

  if (leads.length > 0) {
    const fields = ["name", "domain", "state", "city", "founder", "nextGen", "quote", "sourceUrl", "revenue", "crews", "channel"] as const;
    const tally: Record<string, number> = {};
    for (const c of leads) {
      const g = gradeLead(c, (c as { signal_evidence?: Record<string, unknown>[] }).signal_evidence?.[0]);
      for (const k of fields) if (g[k]) tally[k] = (tally[k] ?? 0) + 1;
    }
    console.log(`\n  DATA COMPLETENESS across ${leads.length} lead${leads.length === 1 ? "" : "s"}:`);
    for (const k of fields) {
      const n = tally[k] ?? 0;
      const bar = "█".repeat(Math.round((n / leads.length) * 12)).padEnd(12, "·");
      console.log(`    ${k.padEnd(11)} ${bar} ${n}/${leads.length}`);
    }

    console.log(`\n  LEADS:`);
    for (const c of leads) {
      const ev = (c as { signal_evidence?: { quote?: string; source_url?: string }[] }).signal_evidence?.[0];
      console.log(`    ${String(c.name).slice(0, 40).padEnd(42)} ${c.city ?? "-"}, ${c.state ?? "-"}  [${c.discovery_channel}]  conf=${c.confidence ?? "fit-only"}`);
      console.log(`      founder:  ${c.founder_name ?? "—"}${c.founder_title ? ", " + c.founder_title : ""}`);
      console.log(`      next gen: ${c.next_gen_name ?? "—"}${c.next_gen_title ? ", " + c.next_gen_title : ""}`);
      if (ev?.quote) console.log(`      quote:    "${String(ev.quote).slice(0, 150)}"`);
      else console.log(`      quote:    — NONE`);
      if (ev?.source_url) console.log(`      source:   ${ev.source_url}`);
    }
  }

  if (cut.length > 0) {
    const reasons = new Map<string, number>();
    for (const c of cut) {
      const r = String(c.rejection_reason ?? "(none)").slice(0, 62);
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
    console.log(`\n  CUT, by reason:`);
    for (const [r, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    ${String(n).padStart(2)}  ${r}`);
    }
    const noDate = cut.filter((c) => !c.recheck_after).length;
    console.log(`    ${cut.length - noDate}/${cut.length} carry a recheck date`);
  }
}

console.log(`\n${"═".repeat(78)}\nTOTAL SPEND THIS SESSION: $${grandTotal.toFixed(4)}\n${"═".repeat(78)}`);

if (!keep && created.length > 0) {
  // Detach before deleting, same order and same reason as reset-leads.mts:
  // companies cascade from searches, so deleting the folder first would take
  // the companies with it and throw away the cross-search memory this run just
  // paid for.
  await sb.from("companies").update({ search_id: null }).in("search_id", created);
  const { data: still } = await sb.from("companies").select("id").in("search_id", created);
  if ((still?.length ?? 0) > 0) {
    console.log(`\n${still?.length} companies still attached — refusing to delete the folders.`);
  } else {
    for (const id of created) await sb.from("searches").delete().eq("id", id);
    console.log(`\nRemoved ${created.length} test folder${created.length === 1 ? "" : "s"}; their companies stay as memory.`);
  }
} else if (keep) {
  console.log(`\nKept ${created.length} folder(s) on the dashboard.`);
}
