/**
 * Scores the live classifier against Christian's 72-company hand-labeled set
 * (13 qualified / 15 needs-verification / 44 rejected, each with a verbatim
 * evidence quote and a live evidence URL).
 *
 * The stated acceptance bar, from the internal scope doc:
 *   "run the crawler over the same geographies and verticals, then check it
 *    against these 72. If it cannot reproduce the 26 no_founder_and_nextgen
 *    cuts, it is keyword-matching 'family' and has not solved the problem."
 *
 * Two modes, because they answer different questions:
 *   MODE A (classifier isolated) — fetch the exact evidence_url the human
 *     auditor used, then classify. Any disagreement is the classifier's
 *     judgment, not a fetch failure.
 *   MODE B (full pipeline) — start from the bare domain and run the real
 *     fetch + page-selection path. Comparing B against A isolates how much
 *     the FETCH step loses on its own (the Russell Landscape question, at
 *     scale).
 *
 * Run: npx tsx --env-file=.env.local ./eval-labeled.mts [A|B|AB]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { classifySignal, disprovePass } from "./lib/pipeline/openrouter";
import { fetchCompanyPages, pickBestPage } from "./lib/pipeline/apify";

type Row = {
  company: string;
  verdict: string;
  reject_reason: string;
  confidence: string;
  founder: string;
  next_gen_contact: string;
  domain: string;
  evidence_url: string;
  vertical: string;
  revenue: string;
};

const rows: Row[] = JSON.parse(readFileSync("./labeled72.json", "utf8"));
const mode = (process.argv[2] ?? "A").toUpperCase();

// Plain free fetch — mirrors the pipeline's own free path so MODE A tests the
// classifier without paying Apify or depending on it.
async function freeText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return text.length < 200 ? null : text;
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], limit: number, run: (t: T, i: number) => Promise<void>) {
  let c = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (c < items.length) {
        const i = c++;
        await run(items[i], i);
      }
    })
  );
}

interface Result {
  company: string;
  labelVerdict: string;
  labelReason: string;
  labelConfidence: string;
  fetched: boolean;
  mySignal: boolean | null;
  myConfidence: string | null;
  mySizeFit: string | null;
  myStillFamily: boolean | null;
  myIndustry: string | null;
  myFounder: string | null;
  myNextGen: string | null;
  error?: string;
}

async function evaluate(getText: (r: Row) => Promise<string | null>, label: string) {
  const results: Result[] = [];
  let done = 0;
  await pool(rows, 5, async (r) => {
    const base: Result = {
      company: r.company,
      labelVerdict: r.verdict,
      labelReason: r.reject_reason,
      labelConfidence: r.confidence,
      fetched: false,
      mySignal: null,
      myConfidence: null,
      mySizeFit: null,
      myStillFamily: null,
      myIndustry: null,
      myFounder: null,
      myNextGen: null,
    };
    try {
      const text = await getText(r);
      if (!text) {
        results.push(base);
        return;
      }
      base.fetched = true;
      const c = await classifySignal(r.company, r.evidence_url, text);
      base.myIndustry = c.industry;
      base.mySizeFit = c.sizeFit;
      base.myStillFamily = c.stillFamilyOwned;
      base.myFounder = c.founderName;
      base.myNextGen = c.nextGenName;
      base.myConfidence = c.confidence;
      base.mySignal = c.qualifies;
      // Mirror the pipeline: a claimed signal must survive the disprove pass.
      if (c.qualifies) {
        try {
          const d = await disprovePass(r.company, c, text);
          if (!d.holds) {
            base.mySignal = false;
            base.myConfidence = null;
          } else if (d.revisedConfidence) {
            base.myConfidence = d.revisedConfidence;
          }
        } catch {
          /* disprove unavailable — keep the first-pass read */
        }
      }
    } catch (e) {
      base.error = (e as Error).message.slice(0, 120);
    }
    results.push(base);
    done++;
    if (done % 10 === 0) process.stderr.write(`  ${label}: ${done}/${rows.length}\n`);
  });
  return results;
}

function report(results: Result[], label: string) {
  const fetched = results.filter((r) => r.fetched);
  console.log(`\n${"=".repeat(72)}\nMODE ${label} — fetched ${fetched.length}/${results.length}\n${"=".repeat(72)}`);

  // THE headline bar: the 26 no_founder_and_nextgen cuts.
  const nfng = results.filter((r) => r.labelReason === "no_founder_and_nextgen");
  const nfngFetched = nfng.filter((r) => r.fetched);
  const nfngAgree = nfngFetched.filter((r) => r.mySignal === false);
  console.log(
    `\nno_founder_and_nextgen cuts: agreed ${nfngAgree.length}/${nfngFetched.length} fetched (of ${nfng.length} labeled)`
  );
  const nfngMiss = nfngFetched.filter((r) => r.mySignal === true);
  if (nfngMiss.length)
    console.log(
      `  FALSE POSITIVES (I claimed a signal the auditor cut):\n` +
        nfngMiss.map((r) => `    - ${r.company} [${r.myConfidence}] ${r.myFounder} -> ${r.myNextGen}`).join("\n")
    );

  // Qualified recall.
  const qual = results.filter((r) => r.labelVerdict.startsWith("QUALIFIED"));
  const qualFetched = qual.filter((r) => r.fetched);
  const qualHit = qualFetched.filter((r) => r.mySignal === true);
  console.log(`\nQUALIFIED recall: found ${qualHit.length}/${qualFetched.length} fetched (of ${qual.length} labeled)`);
  const qualMiss = qualFetched.filter((r) => r.mySignal !== true);
  if (qualMiss.length)
    console.log(`  MISSED:\n` + qualMiss.map((r) => `    - ${r.company} (${r.labelConfidence})`).join("\n"));

  // Ownership gate.
  const nlf = results.filter((r) => r.labelReason === "no_longer_family" && r.fetched);
  console.log(
    `\nno_longer_family: my stillFamilyOwned=false on ${nlf.filter((r) => r.myStillFamily === false).length}/${nlf.length}`
  );

  // Size reads.
  const small = results.filter((r) => r.labelReason === "too_small" && r.fetched);
  const big = results.filter((r) => r.labelReason === "too_big" && r.fetched);
  console.log(
    `too_small: my sizeFit=too_small on ${small.filter((r) => r.mySizeFit === "too_small").length}/${small.length}` +
      `   (unknown on ${small.filter((r) => r.mySizeFit === "unknown").length})`
  );
  console.log(
    `too_big:   my sizeFit=too_big on ${big.filter((r) => r.mySizeFit === "too_big").length}/${big.length}` +
      `   (unknown on ${big.filter((r) => r.mySizeFit === "unknown").length})`
  );

  // Industry umbrella.
  const other = results.filter((r) => r.fetched && r.myIndustry === "other");
  console.log(`\nclassified "other" (out of ICP): ${other.length}`);
  if (other.length) console.log("  " + other.map((r) => r.company).join("\n  "));

  // The 3 name traps.
  const traps = results.filter((r) => /generation|dad and daughter/i.test(r.company));
  console.log(`\nNAME TRAPS (label says cut; a keyword-matcher would pass these):`);
  traps.forEach((r) =>
    console.log(
      `  - ${r.company}: label=${r.labelReason}, mine signal=${r.mySignal} size=${r.mySizeFit} fetched=${r.fetched}`
    )
  );
  return { nfngAgree: nfngAgree.length, nfngFetched: nfngFetched.length, qualHit: qualHit.length, qualFetched: qualFetched.length };
}

const out: Record<string, Result[]> = {};

if (mode.includes("A")) {
  console.error("MODE A: classifier isolated (fetch exact evidence_url)…");
  out.A = await evaluate((r) => freeText(r.evidence_url), "A");
  report(out.A, "A — classifier isolated");
}

if (mode.includes("B")) {
  console.error("\nMODE B: full pipeline (domain -> fetch -> pickBestPage -> classify)…");
  const domains = Array.from(new Set(rows.map((r) => r.domain).filter(Boolean)));
  const pages = await fetchCompanyPages(domains);
  out.B = await evaluate(async (r) => {
    const best = pickBestPage(pages.get(r.domain) ?? []);
    return best?.text ?? null;
  }, "B");
  report(out.B, "B — full pipeline");
}

writeFileSync("./eval-results.json", JSON.stringify(out, null, 1));
console.log("\nwrote eval-results.json");
process.exit(0);
