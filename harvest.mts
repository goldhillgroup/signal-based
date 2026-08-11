/**
 * The weekly harvest, run from a terminal or from CI instead of a web request.
 *
 * WHY THIS EXISTS. On Vercel the crawl half of the harvest runs inside
 * `after()` and is bounded by the function's maxDuration — 300s by default on
 * every plan, and only raisable on Pro with Fluid compute. Two verticals at 20
 * companies each needs about 21 minutes, so the second vertical was being cut
 * off part-way through every single week.
 *
 * A GitHub Actions job has no such ceiling (six hours per job, and a private
 * repo gets 2,000 free minutes a month against the ~85 this uses). So the fix
 * is not to buy a bigger function — it is to stop running the long half inside
 * one. See .github/workflows/weekly-harvest.yml.
 *
 * It shares planHarvest/executeHarvest with the route, so the two cannot
 * drift, and planHarvest claims the day before crawling starts — meaning the
 * Vercel cron and this can both be live without double-spending. Whichever
 * arrives first does the work; the other reads "already ran" and stops.
 *
 *   npx tsx harvest.mts --dry      # decide and report, change nothing
 *   npx tsx harvest.mts            # run it for real if today is a run day
 *   npx tsx harvest.mts --force    # ignore the day/cooldown gate (testing)
 *
 * Env comes from the process (GitHub secrets in CI), falling back to
 * .env.local when one is present, so the same command works in both places.
 */
import fs from "node:fs";

if (fs.existsSync(".env.local")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] ||= line
        .slice(i + 1)
        .trim()
        .replace(/^"|"$/g, "");
    }
  }
}

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY",
  "APIFY_TOKEN",
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  // Names only, never values. Failing here with a list beats failing forty
  // seconds later inside a vendor client with a 401 nobody can trace.
  console.error(`Missing required environment: ${missing.join(", ")}`);
  process.exit(1);
}

const { getSchedule } = await import("./lib/pipeline/schedule.js");
const { shouldRunNow, isoDay, harvestEstimate } = await import("./lib/pipeline/schedule-types.js");
const { planHarvest, executeHarvest } = await import("./lib/pipeline/harvest.js");

const dry = process.argv.includes("--dry");
const force = process.argv.includes("--force");
const now = new Date();

const schedule = await getSchedule();
const decision = shouldRunNow(schedule, now);

// No ceiling here, so report the estimate rather than warn about it — this is
// the driver that can actually finish a long harvest.
const est = harvestEstimate(schedule.targetPerRun, schedule.industries.length, Number.MAX_SAFE_INTEGER);
console.log(`today            ${isoDay(now)}`);
console.log(`enabled          ${schedule.enabled}`);
console.log(`verticals        ${schedule.industries.join(", ")} @ ${schedule.targetPerRun} each`);
console.log(`states           ${schedule.states.join(", ")}`);
console.log(`estimated        ~${est.minutes.toFixed(0)} min of scanning (no ceiling in CI)`);
console.log(`decision         ${decision.run ? "RUN" : "skip"} — ${decision.reason}`);

if (dry) {
  console.log("\nDry run. Nothing changed.");
  process.exit(0);
}

if (!decision.run && !force) {
  // Exit 0: a skip is the correct outcome six days out of seven, and a non-zero
  // exit would turn every ordinary Tuesday into a red X and a notification
  // email about a system that is working exactly as intended.
  process.exit(0);
}

if (force && !decision.run) {
  console.log("\n--force: ignoring the day/cooldown gate (settings are not modified)");
}

const started = Date.now();
const plan = await planHarvest(now, { force });

if (!plan.ran) {
  console.log(`\nDid not run: ${plan.reason}`);
  // A blocked run (no credit) is a real problem worth a red build; a plain
  // skip is not.
  process.exit(plan.blocked || plan.failed.length > 0 ? 1 : 0);
}

console.log(`\nCreated ${plan.started.length} folder(s):`);
for (const s of plan.started) console.log(`  ${s.label}  (${s.industry})`);
if (plan.failed.length > 0) console.log(`failed: ${plan.failed.join(" | ")}`);

console.log("\nCrawling — this is the part a serverless function cannot finish…");
await executeHarvest(plan);

console.log(`\nDone in ${((Date.now() - started) / 60000).toFixed(1)} min.`);

// Report what actually landed, so the CI log is worth reading on its own.
const { createServiceRoleClient } = await import("./lib/supabase/server.js");
const sb = createServiceRoleClient();
for (const s of plan.started) {
  const { data } = await sb
    .from("searches")
    .select("label, status, companies_scanned, qualified_count, verify_count, fit_only_count, rejected_count, cost_estimate_usd, warnings")
    .eq("id", s.id)
    .single();
  if (!data) continue;
  const leads = (data.qualified_count ?? 0) + (data.verify_count ?? 0) + (data.fit_only_count ?? 0);
  console.log(
    `  ${String(data.label).slice(0, 40).padEnd(42)} ${data.status}  read ${data.companies_scanned}  kept ${leads}  cut ${data.rejected_count}  $${(data.cost_estimate_usd ?? 0).toFixed(3)}`
  );
  if (data.warnings) console.log(`      warning: ${data.warnings}`);
}
