/**
 * Model bake-off against the client's own hand-audited set.
 *
 * Answers exactly one question: is a cheaper model AS GOOD, by the definition
 * the scope doc itself gives —
 *
 *   "if it cannot reproduce the 26 no_founder_and_nextgen cuts, it is
 *    keyword-matching 'family' and has not solved the problem."
 *
 * So the decisive subset is those 26 cuts plus the 13 QUALIFIED rows. Getting
 * the cuts right while losing a real lead is not an improvement, and the two
 * numbers have to be read together or a model that rejects everything looks
 * perfect.
 *
 * THREE THINGS THAT MAKE THIS A FAIR TEST AND NOT A VIBE CHECK:
 *
 * 1. Pages are fetched ONCE and cached to disk. Every model then reads
 *    byte-identical input. Re-fetching per model would measure the network and
 *    the site's mood, not the model — and pages change under you.
 * 2. The rubric is held FIXED across models. Tuning the prompt per model would
 *    be a fairer production comparison but an unfair experiment: you could no
 *    longer attribute a difference to the model. Fixed prompt first; per-model
 *    tuning is a follow-up for whichever model wins.
 * 3. Cost is recorded per model from real token pricing, so "as good" and
 *    "cheaper" are answered in one table rather than argued separately.
 *
 * Run:  npx tsx --env-file=.env.local ./bakeoff.mts [--fetch-only] [--models=a,b]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CACHE = "./bakeoff-pages.json";
const OUT = "./bakeoff-results.json";

interface Row {
  company: string;
  verdict: string;
  reject_reason: string;
  domain: string;
  evidence_url: string;
  founder: string;
  next_gen_contact: string;
}

// The two groups the acceptance bar is written in terms of.
const isDecisiveCut = (r: Row) =>
  r.verdict.startsWith("REJECT") && r.reject_reason === "no_founder_and_nextgen";
const isQualified = (r: Row) => r.verdict.startsWith("QUALIFIED");

const all: Row[] = JSON.parse(readFileSync("./labeled72.json", "utf8"));
const decisive = all.filter((r) => isDecisiveCut(r) || isQualified(r));

console.log(
  `Decisive set: ${decisive.length} rows — ${decisive.filter(isDecisiveCut).length} must-cut, ${decisive.filter(isQualified).length} must-keep`
);

// ── Step 1: fetch every page once, cache to disk ──────────────────────────
async function fetchOnce(): Promise<Record<string, string>> {
  if (existsSync(CACHE)) {
    const cached = JSON.parse(readFileSync(CACHE, "utf8"));
    console.log(`Using cached pages (${Object.keys(cached).length})`);
    return cached;
  }
  console.log("Fetching pages (once, free — plain HTTP)…");
  const out: Record<string, string> = {};
  await Promise.all(
    decisive.map(async (r) => {
      const url = r.evidence_url || `https://${r.domain}`;
      try {
        const res = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(20_000),
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SignalRadarEval/1.0)" },
        });
        if (!res.ok) return;
        const html = await res.text();
        // Same crude text extraction the pipeline's free-fetch path uses:
        // strip script/style, tags, collapse whitespace.
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length > 300) out[r.company] = text.slice(0, 12000);
      } catch {
        /* unreachable page — excluded from scoring for EVERY model equally */
      }
    })
  );
  writeFileSync(CACHE, JSON.stringify(out));
  console.log(`Fetched ${Object.keys(out).length} of ${decisive.length}`);
  return out;
}

const pages = await fetchOnce();
if (process.argv.includes("--fetch-only")) process.exit(0);

// Only rows every model can actually read. Scoring a model on a page that
// 404'd would punish it for the network.
const scored = decisive.filter((r) => pages[r.company]);
console.log(
  `Scoring on ${scored.length} readable rows — ${scored.filter(isDecisiveCut).length} must-cut, ${scored.filter(isQualified).length} must-keep\n`
);

// ── Step 2: run each model over the identical cached text ─────────────────
const { classifySignal } = await import("./lib/pipeline/openrouter.js");

const arg = process.argv.find((a) => a.startsWith("--models="));
const MODELS = arg
  ? arg.split("=")[1].split(",")
  : [
      "anthropic/claude-sonnet-5", // baseline — what production runs today
      "anthropic/claude-haiku-4.5",
      "google/gemini-2.5-flash",
      "openai/gpt-5-mini",
    ];

// Live pricing, so the cost column is real rather than remembered.
const priceRes = await fetch("https://openrouter.ai/api/v1/models");
const priceMap = new Map<string, { p: number; c: number }>();
for (const m of (await priceRes.json()).data ?? []) {
  priceMap.set(m.id, { p: parseFloat(m.pricing?.prompt ?? 0), c: parseFloat(m.pricing?.completion ?? 0) });
}

interface Result {
  model: string;
  cutsReproduced: number;
  cutsTotal: number;
  qualifiedKept: number;
  qualifiedTotal: number;
  errors: number;
  estCostUsd: number;
  lostLeads: string[];
  missedCuts: string[];
}

const results: Result[] = [];

for (const model of MODELS) {
  process.env.CLASSIFY_MODEL = model;
  const price = priceMap.get(model);
  let cuts = 0, kept = 0, errors = 0, inTok = 0, outTok = 0;
  const lostLeads: string[] = [];
  const missedCuts: string[] = [];

  process.stdout.write(`${model} … `);
  for (const r of scored) {
    const text = pages[r.company];
    try {
      const c = await classifySignal(r.company, r.evidence_url, text, null);
      // Rough token accounting — good enough for a relative cost column.
      inTok += 2250 + text.length / 4;
      outTok += 350;

      if (isDecisiveCut(r)) {
        // Agreeing with the human means NOT qualifying it.
        if (!c.qualifies) cuts++;
        else missedCuts.push(r.company);
      } else {
        if (c.qualifies) kept++;
        else lostLeads.push(r.company);
      }
    } catch {
      errors++;
    }
  }

  const est = price ? inTok * price.p + outTok * price.c : 0;
  results.push({
    model,
    cutsReproduced: cuts,
    cutsTotal: scored.filter(isDecisiveCut).length,
    qualifiedKept: kept,
    qualifiedTotal: scored.filter(isQualified).length,
    errors,
    estCostUsd: Math.round(est * 1000) / 1000,
    lostLeads,
    missedCuts,
  });
  console.log(`cuts ${cuts}/${scored.filter(isDecisiveCut).length} · kept ${kept}/${scored.filter(isQualified).length} · ~$${est.toFixed(3)}${errors ? ` · ${errors} errors` : ""}`);
}

writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), scoredRows: scored.length, results }, null, 2));

// ── Step 3: the table, read the way the scope doc says to read it ─────────
console.log("\n" + "=".repeat(78));
console.log("model".padEnd(30), "cuts".padStart(8), "kept".padStart(8), "cost".padStart(9), "verdict".padStart(18));
const base = results[0];
for (const r of results) {
  // The bar: reproduce the cuts AND lose no real lead. A model that improves
  // on cuts by dropping a qualified company has not improved.
  const safe = r.qualifiedKept === r.qualifiedTotal;
  const asGood = r.cutsReproduced >= base.cutsReproduced;
  const verdict = !safe ? "LOSES REAL LEADS" : asGood ? "as good or better" : "weaker on cuts";
  console.log(
    r.model.padEnd(30),
    `${r.cutsReproduced}/${r.cutsTotal}`.padStart(8),
    `${r.qualifiedKept}/${r.qualifiedTotal}`.padStart(8),
    `$${r.estCostUsd.toFixed(3)}`.padStart(9),
    verdict.padStart(18)
  );
  if (r.lostLeads.length) console.log(`${" ".repeat(30)}  lost: ${r.lostLeads.join(", ")}`);
}
console.log("=".repeat(78));
console.log(`\nWritten to ${OUT}. Baseline is ${base.model}.`);
console.log(
  `CAUTION: with n=${base.cutsTotal} cuts, a difference of 1-2 is inside noise. ` +
    `Only a large gap, or ANY lost lead, should change a decision.`
);
