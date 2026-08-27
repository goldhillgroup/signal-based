import { tavilySearch } from "./tavily";

/**
 * What LinkedIn says about a company, read through a search index.
 *
 * WHY NOT LINKEDIN ITSELF. Fetching linkedin.com directly breaches their user
 * agreement and they block it in any case; routing it through a scraping actor
 * puts the account doing it at risk. What is legitimate is reading the public
 * profile pages a search engine has already crawled and indexed, which is what
 * this does: Tavily's index, never linkedin.com.
 *
 * WHAT THAT ACTUALLY YIELDS, measured on four of Jonathan's real leads before
 * this was written:
 *
 *   Norman Charles Construction  company page found  -> "11-50 employees"
 *                                Norm Charles, President  (title confirmed)
 *   Pazmany Bros. Landscaping    Peter Pazmany, President at Pazmany Bros.
 *   Estes                        Chad Estes, a family member we did not have
 *   Wichert Homes                nothing at all
 *
 * So: about half the companies return something, company size when the company
 * page happens to be indexed, and titles more often than that. Nothing like
 * full coverage, and worth saying plainly because the temptation with a
 * LinkedIn feature is to imply it knows everything.
 *
 * WHAT IT CANNOT DO: email addresses. LinkedIn does not publish them, and the
 * example that prompted this -- an address found for Estes -- came from their
 * own website AFTER LinkedIn said who to look for. That is the real shape of
 * the win: LinkedIn answers "who", the website or AnymailFinder answers "how
 * to reach them".
 */

export interface LinkedInFind {
  /** e.g. "11-50 employees", copied verbatim from the indexed page. */
  employeeBand: string | null;
  /** The company's own LinkedIn page, when one is indexed. */
  companyUrl: string | null;
  /** People whose profile says they work here. */
  people: { name: string; title: string | null; url: string }[];
  /** Every LinkedIn result seen, so a run can be audited rather than trusted. */
  checked: number;
}

/** "11-50 employees", "1,001-5,000 employees", "2-10 employees". */
const BAND_RE = /\b([\d,]+\s*[-–]\s*[\d,]+|\d[\d,]*\+?)\s+employees\b/i;

/**
 * A profile headline, as the indexed page renders it: "# Peter Pazmany
 * President at Pazmany Bros. Landscaping Los Altos, California…"
 */
function readProfile(content: string): { name: string | null; title: string | null } {
  const flat = content.replace(/\s+/g, " ").trim();
  const named = flat.match(/^#\s+([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,3})\s+(.{3,90}?)(?:\s+\d+\s+connections|\s+##|$)/);
  if (!named) return { name: null, title: null };
  const title = named[2].replace(/\s+(at|@)\s+.*$/i, "").trim();
  return { name: named[1].trim(), title: title.length >= 2 ? title.slice(0, 120) : null };
}

/**
 * "Norman Charles Construction, Inc." -> "norman-charles-construction-inc"
 *
 * TWO FORMS, because "&" has no single right answer. LinkedIn writes
 * "Greenway Landscape Design & Build" as greenway-landscape-design-build,
 * dropping the ampersand, and writes other companies with it spelled out.
 * Expanding it to "and" and stopping there lost a company page we had already
 * found once, so both spellings are generated and either may match.
 */
function slugForms(s: string): string[] {
  const base = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [...new Set([base(s.replace(/&/g, " and ")), base(s.replace(/&/g, " "))])];
}

/**
 * Does this /company/ URL belong to the company we asked about?
 *
 * Either direction of prefix counts, because LinkedIn drops suffixes the
 * registered name carries ("Inc", "LLC") and sometimes keeps them.
 */
function slugMatches(url: string, name: string): boolean {
  const m = url.match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (!m) return false;
  // LinkedIn slugs sometimes carry runs of hyphens: neave-group---outdoor.
  const got = decodeURIComponent(m[1]).toLowerCase().replace(/-+/g, "-").replace(/^-|-$/g, "");
  const drop = (t: string) => t.replace(/-(inc|llc|ltd|co|corp|company)$/g, "");
  for (const form of slugForms(name)) {
    const want = drop(form);
    const g = drop(got);
    if (g === want) return true;
    const shorter = g.length < want.length ? g : want;
    const longer = g.length < want.length ? want : g;
    // A prefix only counts on a WORD boundary: "grasshopper-gardens" must not
    // match "grasshopper-garden-escapes", and it does not, because the shorter
    // stem there ends mid-word.
    if (longer.startsWith(shorter + "-") && shorter.split("-").length >= 2) return true;
  }
  return false;
}

function isLinkedIn(url: string): boolean {
  return /(^|\.)linkedin\.com\//i.test(url.replace(/^https?:\/\//, "x://"));
}

/**
 * Two searches per company: the company page for size, profiles for people.
 *
 * Names we already hold are passed in so a profile can be matched to somebody
 * rather than returned as a stranger. The search for people is deliberately
 * anchored on the COMPANY name, because a search for a person's name alone
 * returns whoever shares it.
 */
export async function lookupOnLinkedIn(company: {
  name: string;
  knownNames?: (string | null)[];
}): Promise<LinkedInFind> {
  const out: LinkedInFind = { employeeBand: null, companyUrl: null, people: [], checked: 0 };
  const known = (company.knownNames ?? [])
    .filter((n): n is string => !!n && n.trim().length > 0)
    .map((n) => n.toLowerCase());

  const queries = [
    `site:linkedin.com/company "${company.name}"`,
    `site:linkedin.com/in "${company.name}" owner OR president OR founder OR "vice president"`,
  ];

  for (const q of queries) {
    let hits: Awaited<ReturnType<typeof tavilySearch>> = [];
    try {
      hits = await tavilySearch(q, { maxResults: 4 });
    } catch {
      // A dark channel is not a failed lookup; whatever the other query found
      // still stands.
      continue;
    }

    for (const h of hits) {
      if (!isLinkedIn(h.url)) continue;
      out.checked++;
      const content = h.content ?? "";

      if (/linkedin\.com\/company\//i.test(h.url)) {
        // MATCHED ON THE URL SLUG, not on the page text. A search for a small
        // builder returns three other builders, and a headcount taken off the
        // wrong one is a confident wrong number on the lead -- worse than the
        // "not stated" it replaces, because nobody would think to check it.
        //
        // The slug is the strict test the text is not: grasshopper-gardens is
        // not grasshopper-garden-escapes, and a prefix comparison on the page
        // body cannot tell those apart.
        if (slugMatches(h.url, company.name)) {
          if (!out.companyUrl) out.companyUrl = h.url;
          const band = content.replace(/\s+/g, " ").match(BAND_RE);
          if (band && !out.employeeBand) out.employeeBand = `${band[1].replace(/\s+/g, "")} employees`;
        }
        continue;
      }

      if (/linkedin\.com\/in\//i.test(h.url)) {
        const { name, title } = readProfile(content);
        if (!name) continue;
        // ONLY A NAME WE ALREADY HOLD. Company-name similarity was the first
        // rule and it was wrong on its first real hit: searching Grasshopper
        // Gardens returned "Annie Hall, President at Grasshopper Garden
        // Escapes, Inc", a different company, and a 14-character prefix match
        // waved her through. She would have arrived on the lead as its
        // president.
        //
        // So this confirms rather than discovers: it can tell you the title
        // and profile of somebody the crawler already found, and it cannot
        // introduce a stranger. Narrower, and every hit is checkable against a
        // name that came off the company's own site.
        const isKnown = known.some((k) => k === name.toLowerCase());
        if (!isKnown) continue;
        if (out.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
        out.people.push({ name, title, url: h.url });
      }
    }
  }

  // ONE MORE ASK, when the right page was found and its snippet happened not
  // to carry the headcount.
  //
  // The snippet a search index returns for the SAME page varies between calls:
  // Grasshopper Gardens gave "51-200 employees" one minute and nothing the
  // next, so the button found a size or did not depending on when it was
  // pressed. Putting the word "employees" in the query makes the index return
  // the part of the page that has it, and on both companies tested it worked
  // where the plain query had just failed.
  //
  // Only when there is a page to attach it to, so this cannot pick a number
  // off a similarly-named company: the slug still has to match.
  if (out.companyUrl && !out.employeeBand) {
    try {
      const more = await tavilySearch(`site:linkedin.com/company "${company.name}" employees`, {
        maxResults: 4,
      });
      for (const h of more) {
        if (!isLinkedIn(h.url) || !slugMatches(h.url, company.name)) continue;
        out.checked++;
        const band = (h.content ?? "").replace(/\s+/g, " ").match(BAND_RE);
        if (band) {
          out.employeeBand = `${band[1].replace(/\s+/g, "")} employees`;
          break;
        }
      }
    } catch {
      // The first pass still stands.
    }
  }

  return out;
}
