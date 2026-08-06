import { resolveSetting } from "../settings";

const MODEL = "anthropic/claude-sonnet-5";

// The scope's ICP revenue band — hardcoded for now since it's core criteria,
// not something Jonathan adjusts per search. Move to a UI field alongside
// vertical/state if that ever changes.
const TARGET_REVENUE_BAND = "$3M-$15M";

// Editable from /dashboard/settings (DB value wins, falls through to the
// env var) — see lib/settings.ts.
export async function getOpenRouterKey(): Promise<string> {
  const key = await resolveSetting("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY);
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return key;
}

// 800 was enough for the original 8-field schema; the revenueEstimate/
// sizeFit/stillFamilyOwned fields added on top of it pushed real responses
// past that and truncated mid-JSON (a real failure seen live, not a
// theoretical one) — 1200 leaves real headroom.
// model is overridable — directory-discovery.ts uses this same helper with
// perplexity/sonar (a real web-search model, ~10x cheaper per token than
// Sonnet, see project memory) instead of the default classify/disprove model.
export async function chat(
  messages: { role: string; content: string }[],
  maxTokens = 1200,
  model: string = MODEL
): Promise<string> {
  const apiKey = await getOpenRouterKey();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter request failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Claude via OpenRouter still wraps JSON in ```json fences fairly often even
// with response_format: json_object — strip markdown before parsing, and
// fall back to grabbing the first {...} block if that still fails.
export function extractJson<T>(raw: string): T {
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`Could not parse JSON from model output: ${raw.slice(0, 200)}`);
  }
}

export interface ClassificationResult {
  companyName: string | null;
  qualifies: boolean;
  industry: "landscaping" | "home_builder" | "other";
  confidence: "high" | "medium" | "verify" | null;
  pageType: "about" | "leadership" | "team" | "home" | "other";
  founderName: string | null;
  founderTitle: string | null;
  nextGenName: string | null;
  nextGenTitle: string | null;
  quote: string | null;
  revenueEstimate: string | null; // e.g. "$5-10M (est.)" — best-effort, from textual proxies
  sizeFit: "too_small" | "in_band" | "too_big" | "unknown";
  stillFamilyOwned: boolean; // false if acquired/consolidated even though history says "family owned"
  rejectionReason: string | null;
}

// Calibrated against a real delivered proof for this exact client (13
// qualified, 15 verify-flagged, dozens of specific cuts across CA/NY/TX/FL)
// — see project memory for the full example. Two corrections from that
// calibration, both directly from Jonathan's own reaction to a first pass
// that was too strict and missing a filter entirely:
//   1. Size/ownership gates were completely absent before — the real proof
//      cuts genuine succession stories for being "too big" (regional/
//      national operators) or "too small" (sub-scale), and cuts companies
//      that still market themselves as "family owned" but have quietly been
//      acquired. Added both as explicit checks below.
//   2. The confidence bar was too strict — the real "verify" tier keeps
//      companies with quite thin evidence (e.g. just "family owned" +  a
//      team page, no explicit two-generation naming in the excerpt). Loosen
//      accordingly: err toward "verify" over rejecting when there's a real,
//      credible hint, not just when it's airtight.
const CLASSIFY_SYSTEM = `You are screening company websites for The Goldhill Group, a coaching practice for family-owned businesses navigating leadership succession. The ICP is strictly landscaping companies and home builders (general contractors / custom home builders) — nothing else.

Do these two extraction steps FIRST, fully, before you even start thinking about the succession signal below. They are not optional side notes — do them for every single page, including ones you already know will be rejected on industry or will show no signal at all. A rejected company with a real name on its page and a blank founderName is a mistake.

STEP 1 — "companyName": the real business name as the page itself presents it (header/logo text, "Welcome to X", copyright line, etc), NOT a search-result title or SEO meta description.

STEP 2 — "founderName"/"founderTitle": read the ENTIRE page text specifically hunting for any named individual presented as running the place — owner, founder, CEO, President, General Manager, Managing Partner, whoever. This field name says "founder" but means "the person to contact" — treat "Owned and operated by John Smith," "Hi, I'm John Smith, owner of X," a name signed at the bottom of an About page, or a name on a team/contact page identically to a literal founder story. Do this whether or not there's any succession angle at all, and whether or not the company will end up qualifying. Only return null after you've actually read the full page text and confirmed no individual is named anywhere — not because the succession story (if any) doesn't need one.

Then identify "industry": "landscaping", "home_builder", or "other" (anything that isn't clearly one of the first two). If "other", this can never qualify — set qualifies: false and say so in rejectionReason.

THE SIGNAL (only relevant if industry is landscaping or home_builder): the company's OWN website names a founder/senior leader AND a next-generation family member together, with some hint of continuity or handoff — this can be explicit ("stepping into the President role") or soft ("family owned and operated" + a team page listing a son/daughter/family surname in a real role). You do NOT need an airtight, fully-spelled-out succession narrative to flag something — a real, credible hint is enough for "verify." Reserve outright rejection for when there is genuinely nothing: only one generation ever named, or a professionally-run team with zero family framing anywhere on the page.

Score confidence:
- "high": both generations clearly named with titles, AND explicit succession/transition language.
- "medium": the pairing is there (named individuals, generational relationship stated or obvious) but succession language is implied rather than spelled out.
- "verify": a real but thinner hint — e.g. "family owned and operated" plus a team page with a plausible family member, or a name mentioned without a clear title, or continuity implied without being stated outright. When genuinely unsure between verify and reject, choose verify — a human reviewing an evidence-backed maybe is the point of this list, not a mistake to avoid.

TWO ADDITIONAL GATES — check these even when the succession signal itself is real and clear (a genuine signal can still get cut on either of these):

1. "stillFamilyOwned" (boolean): is the company CURRENTLY family-run? Read the page for signs it's been acquired, consolidated into a larger platform/holding company, or now run by a purely professional (non-family) executive team — even if the page's history section still says "founded by" a family. Phrases like "a [Company] brand," "part of the [X] family of companies" (as a corporate portfolio, not a literal family), an executive team with no family surnames, or an "our companies" / "our locations" structure typical of a roll-up are all signs of false.

2. "sizeFit": estimate where the company likely falls versus a ${TARGET_REVENUE_BAND} revenue target, using whatever textual proxies the page gives you — years in business, team/crew size, fleet size, service area breadth, number of locations, scale of projects described, review count if mentioned. Return "too_small" (a one or two-person operation, clearly sub-scale), "too_big" (an obvious regional/national-scale operator, multiple states, a large corporate-feeling org chart), "in_band" (plausibly fits), or "unknown" if the page gives no real signal either way — "unknown" is common and fine, do not force a guess; it does not disqualify on its own. Put your best-effort estimate in "revenueEstimate" as a short string like "$5-10M (est.)", or null if truly unknown.

A company only fails on gate 1 or 2 when there's a real, specific reason in the text — not by default, and not from missing information alone (missing info -> "unknown"/null, not an automatic cut).

Respond with ONLY a JSON object (no markdown fences, no prose) matching this shape — note companyName and founderName/founderTitle come first, matching STEP 1/STEP 2 above; fill them in before you reason about the rest:
{
  "companyName": string | null,
  "founderName": string | null,
  "founderTitle": string | null,
  "qualifies": boolean,
  "industry": "landscaping" | "home_builder" | "other",
  "confidence": "high" | "medium" | "verify" | null,
  "pageType": "about" | "leadership" | "team" | "home" | "other",
  "nextGenName": string | null,
  "nextGenTitle": string | null,
  "quote": string | null,
  "revenueEstimate": string | null,
  "sizeFit": "too_small" | "in_band" | "too_big" | "unknown",
  "stillFamilyOwned": boolean,
  "rejectionReason": string | null
}
"quote" must be a short direct excerpt (<= 40 words) copied verbatim from the page text that best supports the decision — required when qualifies is true, null when false unless a quote explains the rejection well.
"rejectionReason" when qualifies is false should read like one of: "Cut — only one generation is on the leadership page, no founder-and-next-gen pair shown together." / "No mention of any leadership team or family members." / a specific, concrete reason in that same plain style. (Size and ownership gates are applied separately after this call, not inside rejectionReason.)
Before answering, double-check: if founderName is null, are you certain no individual is named anywhere on the page — not just that there's no succession story?`;

export async function classifySignal(
  titleHint: string,
  pageUrl: string,
  pageText: string
): Promise<ClassificationResult> {
  const truncated = pageText.slice(0, 6000);
  const raw = await chat([
    { role: "system", content: CLASSIFY_SYSTEM },
    {
      role: "user",
      content: `Search result title (untrusted, likely SEO text — do NOT use as companyName): ${titleHint}\nPage URL: ${pageUrl}\n\nPage text:\n"""\n${truncated}\n"""`,
    },
  ]);
  return extractJson<ClassificationResult>(raw);
}

export interface DisproveResult {
  holds: boolean;
  revisedConfidence: "high" | "medium" | "verify" | null;
  notes: string;
  revisedRejectionReason: string | null;
}

const DISPROVE_SYSTEM = `You are the second reviewer on a lead-qualification pipeline for The Goldhill Group. A first pass classified a company as showing a family-succession signal. Check the same page text for a REAL, SPECIFIC problem with that read — a coincidental surname with no stated relationship, a title that turns out to belong to someone unrelated, an already-fully-completed transition with no founder still in the picture at all, etc.

This is a real check, not a formality, but it is not the place to be a harder grader than the first pass. Thin evidence is normal and expected at "verify" tier — the reference list this system is calibrated against kept companies with quite minimal evidence (e.g. just "family owned and operated" plus a team page) at verify. Only downgrade or reject when you find a concrete, specific reason the read doesn't hold up — never simply because the evidence feels light. When genuinely unsure, let the first pass's read stand.

Respond with ONLY a JSON object (no markdown fences, no prose):
{
  "holds": boolean,
  "revisedConfidence": "high" | "medium" | "verify" | null,
  "notes": string,
  "revisedRejectionReason": string | null
}
"notes" is 1-2 sentences explaining what you checked and why it held or didn't — this gets shown to Jonathan directly, so make it concrete and reference the actual text.`;

export async function disprovePass(
  companyName: string,
  classification: ClassificationResult,
  pageText: string
): Promise<DisproveResult> {
  const truncated = pageText.slice(0, 6000);
  const raw = await chat([
    { role: "system", content: DISPROVE_SYSTEM },
    {
      role: "user",
      content: `Company: ${companyName}\n\nFirst-pass classification:\n${JSON.stringify(
        classification,
        null,
        2
      )}\n\nOriginal page text:\n"""\n${truncated}\n"""`,
    },
  ]);
  return extractJson<DisproveResult>(raw);
}
