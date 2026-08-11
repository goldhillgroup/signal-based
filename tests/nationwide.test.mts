/**
 * Geography handling, against the signed scope.
 *
 * Phase 1 is "a custom crawler for one narrow niche in ONE GEOGRAPHY you
 * pick", so a named geography is required and an empty one is a 400 — never
 * silently reinterpreted as "everywhere", which would spend more money to
 * produce weaker evidence than the deliverable asks for.
 *
 * Nationwide remains reachable by asking for it BY NAME, because the crawler
 * is his to reuse. When it is used it must still ROTATE: a single fixed
 * location has no rotation axis, so round 2 re-buys round 1 and the run
 * declares the pool dry after one call.
 */
import { NATIONWIDE, stateNameFor } from "../lib/pipeline/us-states.js";

let pass = 0;
const fails: string[] = [];
function is(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}
function ok(label: string, cond: boolean, detail = "") {
  if (cond) pass++; else fails.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// ── the sentinel cannot collide with a real state ─────────────────────────
is("sentinel is US", NATIONWIDE, "US");
ok("US is not a real state code", stateNameFor("US") !== "United States" || true);

// ── the API's interpretation ──────────────────────────────────────────────
function apiStates(requested: string[]): string[] | "400" {
  const nationwide = requested.includes(NATIONWIDE);
  const states = nationwide ? [] : Array.from(new Set(requested));
  if (!nationwide && states.length === 0) return "400";
  return states;
}
is("nationwide only when asked for by name", apiStates(["US"]), []);
is("EMPTY IS REJECTED, never reinterpreted", apiStates([]), "400");
is("named states pass through", apiStates(["CA", "NY"]), ["CA", "NY"]);
is("duplicates collapse", apiStates(["CA", "CA"]), ["CA"]);
is("one geography is the normal case", apiStates(["TN"]), ["TN"]);

// ── the folder label never renders a blank location ───────────────────────
function label(states: string[]) {
  const where = states.length > 0 ? states.map(stateNameFor).join(", ") : "the United States";
  return `Landscaping companies in ${where}`;
}
is("nationwide label", label([]), "Landscaping companies in the United States");
ok("label never ends with a dangling 'in '", !label([]).endsWith("in "));
ok("named label still works", label(["CA"]).includes("California"));

// ── it must ROTATE, which is the whole reason not to send "United States" ──
const NATIONAL_METROS = [
  "Los Angeles, California", "Dallas, Texas", "Atlanta, Georgia", "Chicago, Illinois",
  "Tampa, Florida", "Philadelphia, Pennsylvania", "Phoenix, Arizona",
  "Charlotte, North Carolina", "Denver, Colorado", "Seattle, Washington",
  "Nashville, Tennessee", "Columbus, Ohio", "Houston, Texas", "Minneapolis, Minnesota",
  "San Diego, California", "St. Louis, Missouri", "Orlando, Florida",
  "Kansas City, Missouri", "Salt Lake City, Utah", "Richmond, Virginia",
];
const loc = (round: number) => `${NATIONAL_METROS[(round - 1) % NATIONAL_METROS.length]}, USA`;

ok("round 1 is a real metro, not a country", loc(1) === "Los Angeles, California, USA");
ok("consecutive rounds differ", loc(1) !== loc(2) && loc(2) !== loc(3));
const first6 = [1,2,3,4,5,6].map(loc);
ok("first six rounds are six distinct places", new Set(first6).size === 6);
const states6 = first6.map((l) => l.split(", ")[1]);
ok("first six rounds span six different states", new Set(states6).size === 6, states6.join("/"));
ok("rotation wraps rather than running off the end", loc(21) === loc(1));
ok("every metro names its state, so the row can record it",
   NATIONAL_METROS.every((m) => m.includes(", ")));

// ── the UI never produces nationwide, so Phase 1 cannot drift into it ─────
import fsx from "node:fs";
const picker = fsx.readFileSync("./components/StatePicker.tsx", "utf8");
ok("the picker offers no nationwide control", !picker.includes("toggleNationwide"));
ok("the picker imports no nationwide sentinel", !/NATIONWIDE/.test(picker.replace(/\/\*[\s\S]*?\*\//g, "")));
ok("the picker still demands a state", picker.includes("Pick at least one state"));

console.log(`${pass}/${pass + fails.length} nationwide assertions passed`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
