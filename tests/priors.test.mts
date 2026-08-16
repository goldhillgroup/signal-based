/**
 * The yield-ordering must do two things that pull against each other: put the
 * best channel first, AND never let a weaker one be starved out of ever being
 * measured again. A ranking that starves its own evidence is a ratchet, not a
 * learner.
 */
import { orderByYield } from "../lib/pipeline/channel-priors.js";
import type { Candidate } from "../lib/pipeline/apify.js";

const mk = (channel: Candidate["channel"], n: number): Candidate[] =>
  Array.from({ length: n }, (_, i) => ({ domain: `${channel}${i}.com`, url: "", title: "", channel }));

// Rates roughly as measured: web_search best, maps worst.
const rates = { recheck: 0.33, web_search: 0.22, directory: 0.08, licensing: 0.09, maps: 0.04, press: 0.4 } as const;

let pass = 0; const fails: string[] = [];
const ck = (n: string, c: boolean, d = "") => { if (c) pass++; else fails.push(`${n}${d ? " — " + d : ""}`); };

const batch = [...mk("maps", 10), ...mk("web_search", 6), ...mk("directory", 4)];
const out = orderByYield(batch, rates);

ck("nothing is lost", out.length === batch.length, `${out.length} vs ${batch.length}`);
ck("no duplicates", new Set(out.map((c) => c.domain)).size === batch.length);

const firstHalf = out.slice(0, Math.floor(out.length / 2));
const webInFirst = firstHalf.filter((c) => c.channel === "web_search").length;
const mapsInFirst = firstHalf.filter((c) => c.channel === "maps").length;
ck("best channel is front-loaded", webInFirst > batch.filter((c) => c.channel === "web_search").length / 2,
   `${webInFirst} of 6 web_search in the first half`);
ck("worst channel is NOT front-loaded", mapsInFirst < 10 / 2, `${mapsInFirst} of 10 maps in the first half`);

// The exploration floor: weaker channels must still appear early enough to
// keep producing evidence, or their rate can never be revised upward.
const firstThird = out.slice(0, Math.ceil(out.length / 3));
ck("a weaker channel still appears in the first third (exploration floor)",
   firstThird.some((c) => c.channel !== "web_search"),
   firstThird.map((c) => c.channel).join(","));

// Degenerate inputs must not throw or drop rows.
ck("single candidate is returned as-is", orderByYield(mk("maps", 1), rates).length === 1);
ck("empty batch is fine", orderByYield([], rates).length === 0);
ck("all-one-channel batch keeps every row", orderByYield(mk("maps", 7), rates).length === 7);

// recheck is free to discover, so it must outrank everything paid.
const withRecheck = orderByYield([...mk("maps", 6), ...mk("recheck", 2)], rates);
ck("free re-checks sort ahead of paid maps", withRecheck[0].channel === "recheck", withRecheck[0].channel);

console.log(`\n${pass}/${pass + fails.length} passed`);
fails.forEach((f) => console.log("  ✗ " + f));
process.exit(fails.length ? 1 : 0);
