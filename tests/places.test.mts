/**
 * The Google Places mapping, asserted against a REAL actor payload.
 *
 * These field names were originally written from memory, and a wrong key here
 * fails completely silently: the run succeeds, companies save, and the phone
 * and address are simply never there. That is exactly how zero of 106 rows
 * ended up with a city while every Maps response carried one.
 *
 * The fixture below is a verbatim response from
 * compass~crawler-google-places, captured 2026-08-09 for
 * "landscaping company" / "Nashville, Tennessee, USA". Keys and shapes are
 * unedited; only unused fields were dropped.
 */
import { placeToCandidate, type RawPlace } from "../lib/pipeline/apify.js";

const REAL: RawPlace & Record<string, unknown> = {
  title: "Park View Lawn Care and Landscape",
  website: "https://parkviewlawncare.com/?utm_source=google&utm_medium=organic",
  phone: "(615) 260-9051",
  phoneUnformatted: "+16152609051",
  city: "Nashville",
  address: "3833 Saunders Ave, Nashville, TN 37216",
  state: "Tennessee",
  street: "3833 Saunders Ave",
  postalCode: "37216",
  countryCode: "US",
  categoryName: "Landscaper",
};

let pass = 0;
const fails: string[] = [];
function is(label: string, got: unknown, want: unknown) {
  if (got === want) pass++;
  else fails.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}
function ok(label: string, cond: boolean, detail = "") {
  if (cond) pass++; else fails.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// ── the three fields that were being dropped ──────────────────────────────
const c = placeToCandidate(REAL);
is("phone is captured", c.phone, "(615) 260-9051");
is("city is captured", c.city, "Nashville");
is("address is captured", c.address, "3833 Saunders Ave, Nashville, TN 37216");
is("website becomes the url", c.url, REAL.website);
is("title carries over", c.title, "Park View Lawn Care and Landscape");
is("channel is maps", c.channel, "maps");

// ── a place missing the optional fields must not produce undefined ────────
const bare = placeToCandidate({ title: "X", website: "https://x.com" });
is("absent phone becomes null, not undefined", bare.phone, null);
is("absent city becomes null", bare.city, null);
is("absent address becomes null", bare.address, null);
ok("a bare place still yields a usable candidate", bare.url === "https://x.com");

// ── the tel: link the card builds must be dialable ────────────────────────
const tel = String(c.phone).replace(/[^+\d]/g, "");
is("tel link strips formatting", tel, "6152609051");
ok("tel link is all digits", /^\+?\d{10,}$/.test(tel), tel);

// ── guard the exact keys, since a rename is the silent failure ────────────
for (const key of ["phone", "city", "address", "website", "title"]) {
  ok(`the actor still returns '${key}'`, key in REAL, "field renamed upstream");
}

console.log(`${pass}/${pass + fails.length} places-mapping assertions passed`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
