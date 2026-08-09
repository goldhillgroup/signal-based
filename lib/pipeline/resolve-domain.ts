import { hostnameOf, isBlocked } from "./apify";
import { US_STATES } from "./us-states";

/**
 * Company NAME -> that company's own website.
 *
 * The missing piece three separate features are waiting on:
 *
 *   - state licensing boards publish 11,976 California contractors as NAME +
 *     ADDRESS and no website, so that channel is currently unusable
 *   - a news article NAMES a company; it is not the company's site, which is
 *     why succession-phrase web search kept returning newspapers
 *   - trade-press RSS has exactly the same shape
 *
 * A cascade, cheapest first, stopping as soon as a domain is CONFIRMED to
 * belong to the right company.
 *
 * THE VERIFICATION IS THE WHOLE THING. Measured on 25 real companies whose
 * correct domain was already known:
 *
 *   Clearbit autocomplete   8/25 exact  (free, no key)
 *   constructed domain      6/25 exact  — but 15/25 resolved to a LIVE site
 *                                         belonging to somebody else
 *
 * That second number is the trap. "wheelers.com", "highclass.com" and
 * "mysite.com" all load fine and are the wrong company. A resolver that stops
 * at "the domain responds" feeds confident garbage into the classifier, and
 * nobody ever finds out, because a wrong company still produces a plausible
 * verdict. So a candidate is accepted only when the PAGE ITSELF corroborates
 * the name; when nothing does, the honest answer is null.
 */

export interface ResolvedDomain {
  domain: string;
  /** Which rung produced it — recorded so per-source accuracy stays measurable. */
  via: "clearbit" | "constructed";
  /** How the page corroborated it. */
  evidence: string;
}

/** Words carrying no identity — dropped before matching or constructing. */
const NOISE =
  /\b(llc|inc|incorporated|co|corp|corporation|company|ltd|limited|the|and|of|dba)\b/gi;

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[|(].*$/, "") // "Cape Coral Lawn Care | Fast & Affordable"
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The tokens a genuine page would have to mention. */
function tokens(name: string): string[] {
  const GENERIC = new Set([
    "landscaping", "landscape", "lawn", "care", "tree", "service", "services",
    "irrigation", "builder", "builders", "construction", "homes", "home",
    "design", "group", "sons", "brothers", "family", "pros",
  ]);
  const all = normalise(name).split(" ").filter((t) => t.length > 2);
  const distinctive = all.filter((t) => !GENERIC.has(t));
  // A wholly generic name ("Lawn Care Services") has no identity to verify
  // against; fall back to all tokens and let the strict bar below decide.
  return distinctive.length ? distinctive : all;
}

/**
 * Does this page belong to this company? Requires every distinctive token.
 * Deliberately strict: a false accept puts the WRONG company in front of the
 * client as a real lead, while a false reject leaves us exactly where we
 * already are — unable to resolve that one name.
 */
function pageConfirms(name: string, pageText: string): string | null {
  const hay = pageText.toLowerCase();
  const toks = tokens(name);
  if (!toks.length) return null;
  if (toks.some((t) => !hay.includes(t))) return null;
  return `page mentions ${toks.map((t) => `"${t}"`).join(" + ")}`;
}

/**
 * Does the page place the company where expected? True when nothing was asked
 * for — geography is corroboration, never a requirement.
 *
 * Matched loosely on purpose: real sites write "TX", or name only their city,
 * far more often than they spell out "Texas".
 */
function geographyAgrees(
  text: string,
  opts: { city?: string | null; state?: string | null }
): boolean {
  const city = opts.city?.trim();
  const state = opts.state?.trim();
  if (!city && !state) return true;

  const hay = text.toLowerCase();
  if (city && city.length > 2 && hay.includes(city.toLowerCase())) return true;
  if (!state) return false;

  const entry = US_STATES.find(
    (s) =>
      s.code.toLowerCase() === state.toLowerCase() ||
      s.name.toLowerCase() === state.toLowerCase()
  );
  if (hay.includes((entry?.name ?? state).toLowerCase())) return true;

  const code = entry?.code ?? (state.length === 2 ? state : null);
  // Word boundary: a bare "TX" would otherwise match inside unrelated words.
  return code ? new RegExp(`\\b${code}\\b`, "i").test(text) : false;
}

async function readPage(domain: string): Promise<string | null> {
  for (const scheme of ["https://", "http://"]) {
    try {
      const res = await fetch(scheme + domain, {
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SignalRadar/1.0)" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 20000);
    } catch {
      /* try the next scheme */
    }
  }
  return null;
}

/** Rung 1 — Clearbit autocomplete. Free, unauthenticated, ~32% exact. */
async function viaClearbit(name: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as { domain?: string }[];
    return rows.map((r) => r.domain).filter((d): d is string => !!d);
  } catch {
    return [];
  }
}

/** Rung 2 — construct plausible domains from the name. Free, unlimited. */
function constructed(name: string): string[] {
  const words = normalise(name).split(" ").filter(Boolean);
  if (!words.length) return [];
  const stems = new Set<string>([words.join("")]);
  if (words.length > 2) stems.add(words.slice(0, 2).join(""));
  if (words.length > 1) stems.add(words.slice(0, -1).join(""));
  if (words.length > 1) stems.add(words.join("-"));

  const out: string[] = [];
  for (const s of stems) {
    if (s.length < 5 || s.length > 40) continue;
    out.push(`${s}.com`, `${s}.net`);
  }
  return out.slice(0, 8);
}

/**
 * Resolve a company name to its own website, or null when nothing can be
 * confirmed.
 *
 * Geography is a TIEBREAKER, not a gate. An earlier version rejected any page
 * that failed to mention the state and lost two correct answers whose sites
 * simply never say where they are — rejecting your only candidate on missing
 * evidence is not caution, it is discarding the answer. Preferring the
 * geographically-corroborated candidate when there are SEVERAL is what
 * actually kills the same-name-different-state false accept.
 */
export async function resolveDomain(
  name: string,
  opts: { city?: string | null; state?: string | null } = {}
): Promise<ResolvedDomain | null> {
  if (!name || name.trim().length < 3) return null;

  const attempts: { domain: string; via: ResolvedDomain["via"] }[] = [
    ...(await viaClearbit(name)).map((d) => ({ domain: d, via: "clearbit" as const })),
    ...constructed(name).map((d) => ({ domain: d, via: "constructed" as const })),
  ];

  const matches: (ResolvedDomain & { geo: boolean })[] = [];
  const seen = new Set<string>();

  for (const { domain, via } of attempts) {
    const host = hostnameOf(`https://${domain}`) ?? domain;
    if (seen.has(host)) continue;
    seen.add(host);
    // Reuse the existing filters — a foreign TLD, publisher or aggregator is
    // never the company's own site however well the name matched.
    if (isBlocked(host)) continue;

    const text = await readPage(host);
    if (!text) continue;

    const evidence = pageConfirms(name, text);
    if (!evidence) continue;

    const geo = geographyAgrees(text, opts);
    matches.push({ domain: host, via, evidence, geo });
    // Name AND location is as good as it gets — stop rather than fetching
    // more pages for nothing.
    if (geo) break;
  }

  if (matches.length === 0) return null;
  const best = matches.find((m) => m.geo) ?? matches[0];
  return {
    domain: best.domain,
    via: best.via,
    evidence: best.evidence + (best.geo ? " + location" : ""),
  };
}
