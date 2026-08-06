import type { Industry } from "../supabase/types";
import { stateNameFor } from "./us-states";
import { chat, extractJson } from "./openrouter";
import { hostnameOf, isBlocked, fetchSingleUrl, type Candidate } from "./apify";
import { createServiceRoleClient } from "../supabase/server";

// Directory-based discovery — the lesson from a real, separate project
// (Ofer Lieberson, German real-estate deal-sourcing): structured directory
// pages (industry association member lists, licensing boards, buying-
// cooperative shareholder pages) were BY FAR the highest-yield discovery
// source there — near-100% real candidates, vs ~6% from raw search-scraping.
// This is the US-vertical equivalent, as a THIRD discovery channel alongside
// apify.ts's Maps + succession-phrase-search channels.
//
// Uses Claude (via OpenRouter's :online web-search plugin), not Apify — per
// instruction, shift discovery weight off Apify (two accounts ran dry this
// session) and onto OpenRouter.
//
// "Smarter over time" — the actual cost mechanism: finding WHICH directory
// covers a given vertical+state is an expensive web-search call, but the URL
// almost never changes once found. directory_sources caches it (Supabase),
// so the SECOND and every later search for the same vertical+state skips
// straight to "fetch this known page" (cheap: fetchSingleUrl) + "extract
// from this given text" (cheap: a plain, non-search Claude call) instead of
// paying the expensive web-search call again. A cache hit that turns up
// nothing (dead link, page restructured) self-heals: the stale row gets
// deleted and that angle falls back to a fresh expensive search.
const CLAUDE_ONLINE_MODEL = "anthropic/claude-sonnet-5:online";
const CLAUDE_MODEL = "anthropic/claude-sonnet-5"; // no :online — reading text already in hand, no search needed

const DIRECTORY_ANGLES: Record<Industry, string[]> = {
  landscaping: [
    "the official state contractor/landscaper licensing board's public license-holder lookup",
    "NALP (National Association of Landscape Professionals) local chapter or member directory",
    "a local Chamber of Commerce or BBB-accredited-business directory listing for landscaping companies",
  ],
  home_builder: [
    "the official state contractor licensing board's public license-holder lookup for home builders/general contractors",
    "NAHB (National Association of Home Builders) local Home Builders Association member directory",
    "a local Chamber of Commerce or BBB-accredited-business directory listing for custom home builders",
  ],
};

function anglesFor(industry: Industry | null): string[] {
  if (industry) return DIRECTORY_ANGLES[industry];
  return [...DIRECTORY_ANGLES.landscaping, ...DIRECTORY_ANGLES.home_builder];
}

interface DirectoryResult {
  sourceUrl: string | null;
  companies: { name: string; website: string }[];
}

// Expensive path — a real web-search call to FIND the directory (only runs
// on a cache miss, or when a cache hit's page came back empty).
async function searchOneAngle(angle: string, stateName: string): Promise<DirectoryResult> {
  const prompt = `Search the web for ${angle} in ${stateName}, USA.

Read the actual directory/listing page(s) you find and extract REAL company names with their OWN website URLs — not the directory's own page, not a social media profile, not a review site. Only include a company if its name and website came directly from a real directory/listing page in your search results. Never invent a company or use one you merely recall without a direct source found just now.

Also report the single BEST directory/listing page URL you used as "sourceUrl" — the actual page you read the companies from, so it can be revisited directly later without searching again.

Respond with ONLY a JSON object (no markdown fences, no prose): {"sourceUrl": string | null, "companies": [{"name": string, "website": string}]} — up to 15 companies. If you can't find a real directory for this, return {"sourceUrl": null, "companies": []}.`;

  try {
    const raw = await chat([{ role: "user", content: prompt }], 1200, CLAUDE_ONLINE_MODEL);
    const parsed = extractJson<DirectoryResult>(raw);
    return {
      sourceUrl: parsed.sourceUrl ?? null,
      companies: Array.isArray(parsed.companies) ? parsed.companies : [],
    };
  } catch {
    return { sourceUrl: null, companies: [] };
  }
}

// Cheap path — the directory URL is already known; just read it and extract,
// no search fee, no web-search token overhead.
async function extractFromKnownPage(
  pageText: string,
  angle: string,
  stateName: string
): Promise<{ name: string; website: string }[]> {
  const prompt = `This is the text of a business directory/listing page — ${angle} in ${stateName}, USA.

Extract every real company name with its own website URL that's listed on this page. Skip the directory's own links, social media profiles, and anything without a clear company website.

Respond with ONLY a JSON object (no markdown fences, no prose): {"companies": [{"name": string, "website": string}]}.

Page text:
"""
${pageText.slice(0, 6000)}
"""`;

  try {
    const raw = await chat([{ role: "user", content: prompt }], 1000, CLAUDE_MODEL);
    const parsed = extractJson<{ companies: { name: string; website: string }[] }>(raw);
    return Array.isArray(parsed.companies) ? parsed.companies : [];
  } catch {
    return [];
  }
}

async function resolveAngle(
  industry: Industry | null,
  state: string,
  stateName: string,
  angle: string
): Promise<{ name: string; website: string }[]> {
  const supabase = createServiceRoleClient();
  const industryKey = industry ?? "both";

  const { data: cached } = await supabase
    .from("directory_sources")
    .select("*")
    .eq("industry", industryKey)
    .eq("state", state)
    .eq("angle", angle)
    .maybeSingle();

  if (cached) {
    const pageText = await fetchSingleUrl(cached.source_url);
    if (pageText) {
      const companies = await extractFromKnownPage(pageText, angle, stateName);
      if (companies.length > 0) {
        await supabase
          .from("directory_sources")
          .update({ hit_count: cached.hit_count + companies.length, last_used_at: new Date().toISOString() })
          .eq("id", cached.id);
        return companies;
      }
    }
    // Cache hit produced nothing (dead link, restructured page) — self-heal:
    // drop the stale row and fall through to a fresh expensive search below.
    await supabase.from("directory_sources").delete().eq("id", cached.id);
  }

  const { sourceUrl, companies } = await searchOneAngle(angle, stateName);
  if (sourceUrl && companies.length > 0) {
    await supabase
      .from("directory_sources")
      .upsert(
        {
          industry: industryKey,
          state,
          angle,
          source_url: sourceUrl,
          hit_count: companies.length,
          discovered_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "industry,state,angle" }
      );
  }
  return companies;
}

export async function discoverViaDirectories(
  industry: Industry | null,
  states: string[],
  limit: number
): Promise<Candidate[]> {
  const state = states[0] ?? "US";
  const stateName = states.length > 0 ? stateNameFor(states[0]) : "the United States";
  const angles = anglesFor(industry);

  // "Several subagents" — each directory angle runs as its own concurrent
  // call (cache-check + either the cheap or expensive path), same
  // parallelization idea as the Ofer project's parallel Claude Code research
  // agents, translated to what a deployed server-side pipeline can do:
  // concurrent API calls instead of interactive subagents.
  const results = await Promise.all(angles.map((angle) => resolveAngle(industry, state, stateName, angle)));

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const company of results.flat()) {
    if (!company?.website) continue;
    const host = hostnameOf(company.website);
    if (!host || isBlocked(host) || seen.has(host)) continue;
    seen.add(host);
    candidates.push({
      domain: host,
      url: company.website,
      title: company.name || host,
      channel: "directory",
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}
