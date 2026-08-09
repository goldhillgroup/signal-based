/**
 * Asserts email extraction against the shapes real trade-company sites use.
 *
 * The failure that matters is not "missed an address" — it is recording a web
 * designer's mailbox, a CDN's noreply, or a shared inbox labelled as the
 * founder. A wrong contact gets a real email sent to the wrong person under
 * his name; a missing one just costs nothing.
 */
import { extractEmails, bestEmailFor } from "./lib/pipeline/page-email.js";

let pass = 0;
const fails: string[] = [];
function is(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

// ── extraction hygiene ────────────────────────────────────────────────────
is("plain address", extractEmails("Call or email will@greathouselandscape.com today"), ["will@greathouselandscape.com"]);
is("strips trailing period", extractEmails("Reach us at info@acme.com."), ["info@acme.com"]);
is("strips trailing paren", extractEmails("(sales@acme.com)"), ["sales@acme.com"]);
is("uppercase normalized", extractEmails("INFO@ACME.COM"), ["info@acme.com"]);
is("dedupes", extractEmails("bob@acme.com and bob@acme.com"), ["bob@acme.com"]);
is("drops image artifacts", extractEmails("logo@2x.png hero@3x.jpg"), []);
is("drops platform junk", extractEmails("x@sentry.io y@wixpress.com z@example.com"), []);
is("drops numeric local part", extractEmails("12345@acme.com"), []);
is("drops single-char local", extractEmails("a@acme.com"), []);
is("finds several", extractEmails("info@acme.com, will@acme.com").sort(), ["info@acme.com", "will@acme.com"]);

// ── choosing the right one ────────────────────────────────────────────────
const D = "greathouselandscape.com";
is(
  "prefers the named successor over the shared inbox",
  bestEmailFor(["info@" + D, "will@" + D], D, ["Will Greathouse"])?.email,
  "will@" + D
);
is(
  "matches first-initial + surname",
  bestEmailFor(["info@" + D, "wgreathouse@" + D], D, ["Will Greathouse"])?.email,
  "wgreathouse@" + D
);
is(
  "matches first.last",
  bestEmailFor(["will.greathouse@" + D], D, ["Will Greathouse"])?.email,
  "will.greathouse@" + D
);
is(
  "reports which name it matched",
  bestEmailFor(["will@" + D], D, [null, "Will Greathouse"])?.matchedName,
  "Will Greathouse"
);
is(
  "a shared inbox is kept, but not called a person",
  bestEmailFor(["info@" + D], D, ["Will Greathouse"]),
  { email: "info@" + D, kind: "role", matchedName: null }
);
is(
  "an unnamed staff address beats a shared inbox",
  bestEmailFor(["info@" + D, "dispatch2@" + D], D, [])?.email,
  "dispatch2@" + D
);
is(
  "rejects another company's domain entirely",
  bestEmailFor(["hello@somewebdesigner.com"], D, ["Will Greathouse"]),
  null
);
is(
  "accepts the business gmail as a last resort",
  bestEmailFor(["greathouselandscaping@gmail.com"], D, [])?.kind,
  "free_mail"
);
is(
  "on-site beats the gmail",
  bestEmailFor(["greathouse@gmail.com", "info@" + D], D, [])?.email,
  "info@" + D
);
is("nothing usable returns null", bestEmailFor([], D, ["Will Greathouse"]), null);
is(
  "short name tokens cannot match by accident",
  bestEmailFor(["jo@" + D], D, ["Joanne Smith"])?.kind,
  "person"
);

console.log(`${pass}/${pass + fails.length} email assertions passed`);
for (const f of fails) console.log("  ✗ " + f);
process.exit(fails.length ? 1 : 0);
