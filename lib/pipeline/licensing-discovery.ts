import { inflateRawSync } from "node:zlib";
import type { Industry } from "../supabase/types";
import { hostnameOf, isBlocked, decodeEntities, type Candidate } from "./apify";

// State contractor licensing boards — a FOURTH discovery channel, alongside
// apify.ts's Maps + succession-phrase-search and directory-discovery.ts's
// association directories.
//
// WHY THIS EXISTS — the 235x gap. The other three channels pool-exhaust at
// roughly 23-80 companies per state: Maps runs out of distinct places per
// metro, the SERP channel runs out of distinct succession phrasings, and a
// trade association only ever lists its dues-paying members. A licensing board
// has none of those ceilings, because it is not a sample of the market — it IS
// the market. Every contractor who can legally sign a job in the state is in
// it, by law. Measured 2026-08-07: CSLB's C-27 (landscaping) export alone
// returns 11,975 active licenses for California. Against ~50 companies from
// the other channels, that is the single biggest discovery unlock available
// to this pipeline.
//
// ...WITH ONE HARD CONSTRAINT, AND IT IS THE WHOLE STORY OF THIS FILE.
// Licensing rows give you a business NAME. The pipeline needs a DOMAIN —
// discoverCandidates() derives `domain` via hostnameOf(url) and silently drops
// anything that doesn't yield one, so a row with no website is not a weak
// candidate, it is a discarded one. The question that decides this channel's
// value is therefore not "can we enumerate?" (yes, easily) but "does the row
// itself carry a domain?"
//
// The answer, measured rather than assumed (2026-08-07, see PROBE LOG below):
// essentially no. Not one free contractor-licensing source in the country
// publishes an email address or a website for our two verticals. CSLB's C-27
// export contains ZERO "@" characters across all 45,312 distinct strings in
// the file. A scan of 89 licensing datasets on the federated Socrata catalog
// found email columns only on asbestos professionals (IL), water-well
// contractors (DE), city building permits, and NY safety consultants — none
// of them landscaping or home building. Boards publish name, address, phone,
// bond and status. They do not publish how to reach you online.
//
// SO WHAT v1 ACTUALLY EMITS. Two row-intrinsic derivations, both free, both
// requiring zero extra requests per company:
//   1. an email column, if a source ever has one (info@greenscapefl.com ->
//      greenscapefl.com). No supported source populates this today; the path
//      is wired because it is the one that would matter most, and because
//      adding a state that does have it should be a table entry, not a rewrite.
//   2. a business name that IS a domain — "NURSERYTREES.COM LLC",
//      "48HRSHOMEREPAIR.COM LLC", "WEREMODEL.COM LLC". Rare but real, and
//      free: the domain is sitting in the name the board already published.
// Both run through the same freemail filter, because a gmail.com address is a
// mailbox, not a company website, and fetching gmail.com teaches us nothing.
//
// WHAT v1 DELIBERATELY DOES NOT DO — and what v2 is. The obvious move is
// name -> domain resolution: take "RUSSELL LANDSCAPE GROUP, Sacramento CA" and
// go find russelllandscape.com. Every version of that is a per-company lookup
// — a paid search API call, or a guess-and-probe against DNS. At 11,975 rows
// for one classification in one state, a paid resolver is a five-figure
// discovery bill, and a guess-and-probe resolver is ~12,000 outbound requests
// with a false-positive rate nobody has measured. That is a real feature with
// a real design, and it is NOT built here. This file's job is to prove the
// enumeration works, get the free domains out, and leave the resolver as a
// clean seam: everything below already parses and caches the FULL row set, so
// v2 only has to add a deriveDomain() strategy, not a new channel.
//
// The honest summary of this channel's v1 value: the enumeration is proven and
// large, the emission is small. It is worth having anyway — the candidates it
// does emit are free, and the row set it caches is exactly what the v2
// resolver will consume.
//
// ── PROBE LOG (all requests actually made 2026-08-07) ────────────────────────
// CA  CSLB   https://www.cslb.ca.gov/onlineservices/dataportal/ListByClassification
//            WORKS. ASP.NET postback -> .xlsx attachment. C-27: HTTP 200,
//            1,210,949 bytes, 11,975 rows, ~23s. B-2: HTTP 200, 168,284
//            bytes, ~4.5s. B (General Building) HTTP 504 at ~30s — too large
//            for their exporter to build; C-27 + B requested together also
//            504s, so classifications are fetched one request each.
//            Columns: LicenseNumber, LastUpdated, BusinessType, BusinessName,
//            Address, City, State, Zip, County, PhoneNumber, IssueDate,
//            ExpirationDate, Classification, Status. No email, no website.
// FL  DBPR   https://www2.myfloridalicense.com/construction-industry/public-records/
//            BLOCKED. HTTP 403 with `cf-mitigated: challenge` on every
//            attempt: browser UA, curl default UA, forced HTTP/1.1, forced
//            HTTP/2, and Node's own fetch (the exact client this module would
//            use in production). The whole host sits behind a Cloudflare
//            JavaScript challenge, including the /sto/file_download/extracts/
//            paths, so the free weekly CSV extracts DBPR publishes cannot be
//            downloaded by any headless client. Not a URL we got wrong —
//            a bot wall. Rendering it would mean paying Firecrawl per fetch.
// TX  TDLR   https://www.tdlr.texas.gov/LicenseSearch/licfile.asp
//            HTTP 200, and genuinely excellent: 149 free daily CSVs. But zero
//            of them are ours — "landscap", "irrigat", "builder", "general
//            contractor", "residential construction" and "roof" all return 0
//            hits on that page, because Texas does not license landscapers or
//            home builders at state level at all. Sampled Lteecele.csv
//            (Electrical Contractors, HTTP 200, 3.8 MB) to check the shape:
//            23 columns, no email. Unsupported for a reason no code can fix.
// NC  NCLBGC https://portal.nclbgc.org/Public/_Search/
//            HTTP 200 and the XHR endpoint works, but it is a lookup, not an
//            enumeration: POSTing a classification alone returns "Additional
//            Inputs Needed", so it must be walked city by city. Worse, the
//            result rows carry only Account #, Type and Owner — no address,
//            no email, no website. Nothing to derive a domain from even after
//            paying for the walk.
// WA  L&I    https://data.wa.gov/resource/m8qx-ubtq.json  (Socrata, free, no key)
//            WORKS. 19 columns, filterable server-side by specialtycode1desc:
//            LANDSCAPING 3,230 / Tree Removal Service 1,266 / GENERAL 115,282
//            / RESIDENTIAL 1,780. No email, no website.
// OR  CCB    https://data.oregon.gov/resource/g77e-6bhs.json  (Socrata, free)
//            WORKS. endorsement_text: Residential General Contractor 30,282.
//            No email, no website. Note Oregon licenses landscapers through a
//            SEPARATE board (LCB), so CCB has no landscaping endorsement to
//            filter on — landscaping falls back to a trade-word name match.
// ─────────────────────────────────────────────────────────────────────────────

/** One licensee as this module cares about it. */
interface LicenseRow {
  name: string;
  city: string | null;
  /** Board's own classification/specialty text — kept for the v2 resolver. */
  classification: string | null;
  /** No supported source populates this today. See the header. */
  email: string | null;
}

/**
 * Per-state support, as a discriminated union rather than `impl | null` so an
 * unsupported state can carry WHY it's unsupported and WHEN that was checked.
 * A negative finding that isn't written down gets re-investigated every few
 * months; one that is written down is a decision.
 */
type StateSupport =
  | {
      supported: true;
      board: string;
      load: (industry: Industry | null) => Promise<LicenseRow[]>;
    }
  | { supported: false; board: string; reason: string };

// Freemail hosts. An email domain is only a usable WEBSITE domain when the
// company actually owns it — info@greenscapefl.com is a real site,
// greenscapefl@gmail.com is a mailbox, and fetching gmail.com to look for a
// founder's son on the About page is obviously nonsense.
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "aol.com",
  "outlook.com",
  "icloud.com",
  "msn.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "sbcglobal.net",
  "bellsouth.net",
  "me.com",
  "live.com",
  "mac.com",
  "protonmail.com",
  "ymail.com",
  "cox.net",
  "earthlink.net",
  "juno.com",
]);

// A business name that contains its own domain: "NURSERYTREES.COM LLC",
// "LOBERG ROOFING.COM INC", "WE INSTALL FLOORS.COM". Spaces are allowed inside
// the captured label and stripped afterwards, because boards store the name as
// typed on the application form and "BATH CONVERSION.COM" is registered as
// bathconversion.com.
//
// Deliberately limited to .com/.net/.org/.biz. Adding .co and .us looked
// harmless until you notice how many real company names end in "CO." — the
// TLDs here are the ones actually observed in these files, and every one of
// them showed up as .com.
const DOMAIN_IN_NAME_RE = /([A-Za-z0-9][A-Za-z0-9 '&-]{0,60})\.(com|net|org|biz)\b/i;

/**
 * The one derivation v1 performs. Returns a bare hostname, or null when this
 * row simply cannot pay its way into the pipeline — which, per the header, is
 * the overwhelmingly common answer and is fine.
 */
export function deriveDomain(row: LicenseRow): string | null {
  // 1. Email column, if a source ever has one.
  if (row.email) {
    const at = row.email.trim().toLowerCase().split("@");
    const host = at.length === 2 ? at[1].replace(/^www\./, "") : "";
    if (host && host.includes(".") && !FREEMAIL_DOMAINS.has(host)) return host;
  }

  // 2. The name itself is a domain.
  const m = DOMAIN_IN_NAME_RE.exec(row.name);
  if (m) {
    const label = m[1]
      .replace(/[ '&]/g, "")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    // A single letter isn't a company domain, and an all-digit label is
    // usually a licence or address fragment that happened to sit before a dot.
    if (label.length >= 2 && /[a-z]/.test(label)) {
      const host = `${label}.${m[2].toLowerCase()}`;
      if (!FREEMAIL_DOMAINS.has(host)) return host;
    }
  }

  return null;
}

// ── Minimal .xlsx reader ────────────────────────────────────────────────────
// CSLB's data portal only offers .xlsx — there is no CSV option on the page,
// the sole control is a "Download" button that posts back and streams a
// spreadsheet. Rather than add a parsing dependency for one caller, this reads
// the two entries it needs straight out of the zip container. An .xlsx is a
// zip of XML; both files we want are plain deflate.

/** Inflate only the named entries, walking the central directory. */
function readZipEntries(buf: Buffer, wanted: Set<string>): Map<string, string> {
  const out = new Map<string, string>();

  // End-of-central-directory record, scanned backwards from the tail. The
  // comment field can be up to 64 KB, so that's how far back we look.
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (wanted.has(name) && localOff + 30 <= buf.length) {
      // Sizes live in the central directory; the local header's copies can be
      // zeroed when the writer streamed the entry, so only its two length
      // fields are trusted here.
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      try {
        out.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString("utf8"));
      } catch {
        // A corrupt entry costs us that file, not the whole download.
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeXml(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e] ?? e)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

// CSLB writes the `x:` namespace prefix on every element; other writers don't.
// Every pattern below accepts either, so a future re-export by a different
// toolchain doesn't silently parse as zero rows.
const SI_RE = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
const T_RE = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
const ROW_RE = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
const CELL_RE = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
const V_RE = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/;

/**
 * Parse an .xlsx buffer into rows keyed by HEADER NAME rather than column
 * index. Header drift is the failure mode that matters here: CSLB can add a
 * column to their export at any time and, positionally parsed, that silently
 * turns every BusinessName into an Address. Reading row 1 as the key map means
 * a new column is a no-op and a RENAMED column is a clean zero, not garbage.
 */
function parseXlsx(buf: Buffer): Record<string, string>[] {
  const entries = readZipEntries(
    buf,
    new Set(["xl/sharedStrings.xml", "xl/worksheets/sheet.xml", "xl/worksheets/sheet1.xml"])
  );
  const sheetXml =
    entries.get("xl/worksheets/sheet.xml") ?? entries.get("xl/worksheets/sheet1.xml");
  if (!sheetXml) return [];

  const shared: string[] = [];
  const sharedXml = entries.get("xl/sharedStrings.xml");
  if (sharedXml) {
    SI_RE.lastIndex = 0;
    for (let m = SI_RE.exec(sharedXml); m; m = SI_RE.exec(sharedXml)) {
      // An <si> can hold several <t> runs when the cell had mixed formatting.
      let text = "";
      T_RE.lastIndex = 0;
      for (let t = T_RE.exec(m[1]); t; t = T_RE.exec(m[1])) text += t[1];
      shared.push(unescapeXml(text));
    }
  }

  const cellsOf = (rowXml: string): string[] => {
    const values: string[] = [];
    CELL_RE.lastIndex = 0;
    for (let c = CELL_RE.exec(rowXml); c; c = CELL_RE.exec(rowXml)) {
      const attrs = c[1] ?? "";
      const inner = c[2] ?? "";
      // Column letter -> index, so a sparse row (empty cells omitted, which
      // this exporter does) doesn't shift every later value left.
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      let idx = values.length;
      if (ref) {
        idx = 0;
        for (const ch of ref) idx = idx * 26 + (ch.charCodeAt(0) - 64);
        idx -= 1;
      }
      const raw = V_RE.exec(inner)?.[1] ?? "";
      const isShared = /\bt="s"/.test(attrs);
      const value = isShared ? shared[Number(raw)] ?? "" : unescapeXml(raw);
      while (values.length < idx) values.push("");
      values[idx] = value;
    }
    return values;
  };

  const out: Record<string, string>[] = [];
  let header: string[] | null = null;
  ROW_RE.lastIndex = 0;
  for (let r = ROW_RE.exec(sheetXml); r; r = ROW_RE.exec(sheetXml)) {
    const values = cellsOf(r[1]);
    if (!header) {
      header = values.map((h) => h.trim());
      continue;
    }
    const rec: Record<string, string> = {};
    header.forEach((key, i) => {
      if (key) rec[key] = (values[i] ?? "").trim();
    });
    out.push(rec);
  }
  return out;
}

// ── California — CSLB ───────────────────────────────────────────────────────

const CSLB_URL = "https://www.cslb.ca.gov/onlineservices/dataportal/ListByClassification";
const CSLB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

// C-27 is Landscaping. B-2 is Residential Remodeling, and it is standing in
// for B (General Building) on purpose: B is the classification we actually
// want for home builders, but CSLB's exporter cannot build it — it returns
// HTTP 504 after ~30 seconds, every time, alone or paired. B-2 is the largest
// residential-construction classification that the export endpoint will
// actually produce, so it is what this state can offer for that vertical.
const CSLB_CLASSES: Record<Industry, string[]> = {
  landscaping: ["C-27"],
  home_builder: ["B-2"],
};

/** One classification = one postback. See CSLB_CLASSES for why not batched. */
async function fetchCslbClassification(classification: string): Promise<LicenseRow[]> {
  // ASP.NET WebForms: the POST is only accepted with the __VIEWSTATE and
  // __EVENTVALIDATION tokens minted by a GET of the same page, plus that GET's
  // session cookie. Two requests, always, and they cannot be cached across
  // runs — the tokens are bound to the session.
  const page = await fetch(CSLB_URL, {
    headers: { "User-Agent": CSLB_UA },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!page.ok) throw new Error(`CSLB form page ${page.status}`);
  const html = await page.text();
  const cookies = (page.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  const hidden = (name: string) =>
    new RegExp(`id="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

  const body = new URLSearchParams({
    __EVENTTARGET: "ctl00$MainContent$btnSearch",
    __EVENTARGUMENT: "",
    __VIEWSTATE: hidden("__VIEWSTATE"),
    __VIEWSTATEGENERATOR: hidden("__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: hidden("__EVENTVALIDATION"),
    "ctl00$MainContent$lbClassification": classification,
  });

  const res = await fetch(CSLB_URL, {
    method: "POST",
    headers: {
      "User-Agent": CSLB_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: CSLB_URL,
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: body.toString(),
    redirect: "follow",
    // C-27 measured ~23s for 1.2 MB. 45s leaves headroom for a slow day
    // without letting a wedged export hold a discovery round open.
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`CSLB export ${classification}: HTTP ${res.status}`);

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("spreadsheet")) {
    // A 200 that returns the form HTML again means the postback was rejected
    // (expired tokens, changed control names). Loud, because it's the failure
    // that would otherwise look exactly like "California has no landscapers."
    throw new Error(`CSLB export ${classification}: expected xlsx, got ${ct.slice(0, 60)}`);
  }

  const records = parseXlsx(Buffer.from(await res.arrayBuffer()));
  return records.map((r) => ({
    name: r.BusinessName ?? "",
    city: r.City || null,
    classification: (r.Classification ?? classification).trim() || null,
    // Documented absence, not an oversight — there is no email column in this
    // export. See the header's measurement.
    email: null,
  }));
}

async function loadCalifornia(industry: Industry | null): Promise<LicenseRow[]> {
  const classes = industry
    ? CSLB_CLASSES[industry]
    : [...CSLB_CLASSES.landscaping, ...CSLB_CLASSES.home_builder];

  const settled = await Promise.allSettled(classes.map(fetchCslbClassification));
  const rows = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  // Only a total failure is worth surfacing as a channel error; losing one of
  // two classifications should still return the other's rows.
  if (rows.length === 0 && settled.every((s) => s.status === "rejected")) {
    const first = settled[0];
    throw new Error(
      first && first.status === "rejected"
        ? String(first.reason?.message ?? first.reason)
        : "CSLB returned no rows"
    );
  }
  return rows;
}

// ── Socrata-backed states ───────────────────────────────────────────────────
// data.wa.gov and data.oregon.gov are both Socrata, which means SoQL: the
// filtering happens on their server, for free, with no API key. That matters
// more than it sounds. WA's GENERAL specialty alone is 115,282 rows; pulling
// it down to filter locally would be a multi-MB download per discovery call to
// find a handful of usable rows. Asking the server for exactly the rows v1 can
// use turns that into a single small response.
//
// The cost of that choice, stated plainly: what gets cached for these states is
// the domain-BEARING subset, not the full universe. The same query with the
// domain predicate removed returns the full enumeration, which is what the v2
// resolver will want — see buildDomainPredicate's caller.

const SOCRATA_TIMEOUT_MS = 25000;

/**
 * The SoQL half of deriveDomain's "name is a domain" rule. Kept in lockstep
 * with DOMAIN_IN_NAME_RE's TLD list on purpose: a TLD the predicate accepts
 * but the regex rejects just wastes rows, and the reverse silently hides them.
 */
function buildDomainPredicate(column: string): string {
  return (
    "(" +
    ["com", "net", "org", "biz"]
      .map((tld) => `upper(${column}) like '%.${tld.toUpperCase()}%'`)
      .join(" OR ") +
    ")"
  );
}

async function socrataQuery(
  host: string,
  dataset: string,
  params: Record<string, string>
): Promise<Record<string, string>[]> {
  const url = new URL(`https://${host}/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(SOCRATA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Socrata ${host}/${dataset}: HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

// Washington L&I. specialtycode1desc is the board's own trade classification,
// so the vertical filter is theirs, not ours. The landscaping umbrella matches
// the one the rest of the pipeline uses (see apify.ts's VERTICAL_SEARCH_TERMS
// and openrouter.ts's CLASSIFY_SYSTEM): tree work and irrigation count.
const WA_SPECIALTY_LIKE: Record<Industry, string[]> = {
  landscaping: ["%LANDSCAP%", "%TREE%", "%IRRIGAT%"],
  home_builder: ["%GENERAL%", "%RESIDENTIAL%", "%FRAMING%"],
};

async function loadWashington(industry: Industry | null): Promise<LicenseRow[]> {
  const likes = industry
    ? WA_SPECIALTY_LIKE[industry]
    : [...WA_SPECIALTY_LIKE.landscaping, ...WA_SPECIALTY_LIKE.home_builder];
  const trade = likes.map((l) => `upper(specialtycode1desc) like '${l}'`).join(" OR ");

  const rows = await socrataQuery("data.wa.gov", "m8qx-ubtq", {
    $select: "businessname,city,specialtycode1desc",
    $where: `contractorlicensestatus='ACTIVE' AND (${trade}) AND ${buildDomainPredicate("businessname")}`,
    $limit: "2000",
  });

  return rows.map((r) => ({
    name: r.businessname ?? "",
    city: r.city || null,
    classification: r.specialtycode1desc || null,
    email: null,
  }));
}

// Oregon CCB. endorsement_text is a clean filter for builders. Landscaping has
// no endorsement to filter on at all — Oregon licenses landscape contractors
// through a separate board (LCB) that this module has not probed — so that
// vertical falls back to matching trade words in the company name, which is
// weaker and is meant to be.
const OR_ENDORSEMENT_LIKE = ["%RESIDENTIAL GENERAL%", "%RESIDENTIAL DEVELOPER%", "%COMMERCIAL GENERAL%"];
const OR_LANDSCAPE_NAME_LIKE = ["%LANDSCAP%", "%TREE%", "%LAWN%", "%IRRIGAT%", "%NURSERY%"];

async function loadOregon(industry: Industry | null): Promise<LicenseRow[]> {
  const clauses: string[] = [];
  if (industry !== "landscaping") {
    clauses.push(OR_ENDORSEMENT_LIKE.map((l) => `upper(endorsement_text) like '${l}'`).join(" OR "));
  }
  if (industry !== "home_builder") {
    clauses.push(OR_LANDSCAPE_NAME_LIKE.map((l) => `upper(full_name) like '${l}'`).join(" OR "));
  }
  const trade = clauses.map((c) => `(${c})`).join(" OR ");

  const rows = await socrataQuery("data.oregon.gov", "g77e-6bhs", {
    $select: "full_name,city,endorsement_text",
    $where: `(${trade}) AND ${buildDomainPredicate("full_name")}`,
    $limit: "2000",
  });

  return rows.map((r) => ({
    name: r.full_name ?? "",
    city: r.city || null,
    classification: r.endorsement_text || null,
    email: null,
  }));
}

// ── The support table ───────────────────────────────────────────────────────
// Every entry, positive or negative, is backed by a request in the PROBE LOG.
// An unsupported state is not an error and not a gap to be filled later by
// guessing — it is a checked, dated finding.

const LICENSING_SOURCES: Record<string, StateSupport> = {
  CA: { supported: true, board: "CSLB (Contractors State License Board)", load: loadCalifornia },
  WA: { supported: true, board: "WA L&I contractor registration", load: loadWashington },
  OR: { supported: true, board: "Oregon CCB (Construction Contractors Board)", load: loadOregon },

  FL: {
    supported: false,
    board: "Florida DBPR / CILB",
    reason:
      "No free enumerable source, checked 2026-08-07: DBPR does publish free weekly CSV extracts, but www2.myfloridalicense.com answers every headless client with HTTP 403 cf-mitigated:challenge (browser UA, curl default UA, HTTP/1.1, HTTP/2 and Node fetch all tested). Reaching it would require a paid rendering fetch.",
  },
  TX: {
    supported: false,
    board: "Texas TDLR",
    reason:
      "No free enumerable source, checked 2026-08-07: TDLR's licfile.asp serves 149 free daily CSVs, but Texas does not license landscapers or home builders at state level, so none of the 149 covers either vertical.",
  },
  NC: {
    supported: false,
    board: "NC Licensing Board for General Contractors",
    reason:
      "No free enumerable source, checked 2026-08-07: portal.nclbgc.org's search endpoint is a per-city lookup, not an export (a classification alone returns 'Additional Inputs Needed'), and its result rows carry only account number, type and owner name, no address, email or website to derive a domain from.",
  },
};

// ── Row cache ───────────────────────────────────────────────────────────────
// These files change monthly at best (CSLB stamps a LastUpdated per row; WA
// and OR refresh on their own schedule). Re-downloading 1.2 MB of California
// on every discovery call — and the orchestrator re-invokes discovery every
// time its candidate buffer drains — would be pure waste. 6 hours is long
// enough that no single search ever pays twice, short enough that a run
// tomorrow sees a fresh file.
//
// The PROMISE is cached, not the resolved rows, so two rounds firing
// concurrently on a cold process share one download instead of racing into
// two. A rejected promise is evicted immediately so a transient 504 doesn't
// pin the failure for six hours.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const rowCache = new Map<string, { at: number; rows: Promise<LicenseRow[]> }>();

function loadRows(state: string, industry: Industry | null): Promise<LicenseRow[]> {
  const source = LICENSING_SOURCES[state];
  if (!source?.supported) return Promise.resolve([]);

  const key = `${state}|${industry ?? "both"}`;
  const hit = rowCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  const rows = source.load(industry);
  rowCache.set(key, { at: Date.now(), rows });
  rows.catch(() => {
    if (rowCache.get(key)?.rows === rows) rowCache.delete(key);
  });
  return rows;
}

// Emission cap per call. The orchestrator's buffer consumes surplus across
// later rounds, so there is no reason to hand it 12,000 candidates at once —
// but there is also no reason to re-emit the same head every round, which is
// what the Maps and SERP channels each had to be fixed for (see apify.ts).
const EMIT_CAP = 200;

/**
 * Round N's slice, wrapping. Exported because it is the one piece of behaviour
 * here worth asserting directly: with today's sources every state yields fewer
 * than EMIT_CAP usable rows, so live rotation is a documented no-op and a live
 * test cannot observe it. That will stop being true the moment the v2
 * name->domain resolver lands and a slice of California is 11,975 long.
 */
export function rotateSlice<T>(items: T[], round: number, size: number): T[] {
  if (items.length === 0) return [];
  if (items.length <= size) return items;
  const start = ((round - 1) * size) % items.length;
  const slice = items.slice(start, start + size);
  // Wrap rather than return a short tail — a round should get a full slice.
  if (slice.length < size) slice.push(...items.slice(0, size - slice.length));
  return slice;
}

/**
 * Which state this call covers. Mirrors directory-discovery's round-rotation so
 * a multi-state search doesn't spend every round on states[0] — but with one
 * addition: it skips forward past states this channel cannot serve. Without
 * that, a "California + Texas" search would spend half its licensing rounds
 * returning [] for Texas, which is not a useful use of a round when California
 * is right there.
 */
function stateForRound(states: string[], round: number): string | null {
  const pool = states.filter((s) => LICENSING_SOURCES[s]?.supported);
  if (pool.length === 0) return null;
  return pool[(round - 1) % pool.length];
}

/**
 * Channel D — state contractor licensing boards.
 *
 * Returns [] rather than throwing when a state has no free enumerable source;
 * an unsupported state is a known fact about the world, not a failure of this
 * round, and it must not show up in the UI as a degraded channel.
 */
export async function discoverViaLicensing(
  industry: Industry | null,
  states: string[],
  limit: number,
  round = 1
): Promise<Candidate[]> {
  const state = stateForRound(states, round);
  if (!state) return [];

  const rows = await loadRows(state, industry);

  // Derive across the WHOLE cached row set before slicing, not within a
  // rotating window of raw rows. With usable domains at roughly 0.1% of rows,
  // window-first would hide the handful that exist behind window boundaries
  // and most rounds would emit nothing at all. Cap-then-rotate keeps every
  // reachable candidate reachable.
  const seen = new Set<string>();
  const usable: Candidate[] = [];
  for (const row of rows) {
    if (!row.name) continue;
    const derived = deriveDomain(row);
    if (!derived) continue;
    const url = `https://${derived}`;
    const host = hostnameOf(url);
    if (!host || isBlocked(host) || seen.has(host)) continue;
    seen.add(host);
    usable.push({
      domain: host,
      url,
      title: decodeEntities(row.name),
      channel: "licensing",
    });
  }

  return rotateSlice(usable, round, EMIT_CAP);
}
