const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = "anthropic/claude-sonnet-5";

async function chat(messages: { role: string; content: string }[], maxTokens = 700): Promise<string> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
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
function extractJson<T>(raw: string): T {
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
  rejectionReason: string | null;
}

const CLASSIFY_SYSTEM = `You are screening company websites for The Goldhill Group, a coaching practice for family-owned businesses navigating leadership succession. The ICP is strictly landscaping companies and home builders (general contractors / custom home builders) — nothing else.

First read the page for the real company name ("companyName") — the actual business name as the page itself presents it (header/logo text, "Welcome to X", copyright line, etc), NOT a search-result title or SEO meta description. A Google-search title like "Landscaping, Sod, Retaining Walls | Woodstock, GA" is not a company name; the real name is usually shorter and appears in the page's own branding (e.g. "Mixon Landscaping"). If the page text genuinely gives no clue, return null rather than guessing.

Then identify "industry": "landscaping", "home_builder", or "other" (anything that isn't clearly one of the first two — e.g. HVAC, roofing, a landscape architecture firm with no install crews, a real-estate brokerage). If "other", this can never qualify regardless of the succession signal — set qualifies: false and say so in rejectionReason.

The signal you are looking for (only relevant if industry is landscaping or home_builder): the company's OWN website (About/Team/Leadership page) names TWO GENERATIONS together — a founder or senior leader still active AND a named next-generation family member in a real role — with some language suggesting succession, transition, or the business passing down. This must come from the page text itself, not be inferred from a shared last name alone.

Score confidence:
- "high": both generations clearly named with titles, AND explicit succession/transition language (e.g. "planning his transition," "stepping into the President role," "next generation of leadership").
- "medium": the pairing is there but succession language is implied rather than stated outright (e.g. two people just have the same last name and clearly-generational titles, with no explicit "transition" language).
- "verify": borderline — a real hint (e.g. a name mentioned without a title, or family language without a second name) that a human should double-check, not something to score confidently either way.

If there is no such pairing at all (only the founder, or a professionally-managed team with no family framing, or a family member with a title but no succession language and no reason to think this is a transition), it does NOT qualify — return qualifies: false with a short, specific rejectionReason.

Respond with ONLY a JSON object (no markdown fences, no prose) matching this shape:
{
  "companyName": string | null,
  "qualifies": boolean,
  "industry": "landscaping" | "home_builder" | "other",
  "confidence": "high" | "medium" | "verify" | null,
  "pageType": "about" | "leadership" | "team" | "home" | "other",
  "founderName": string | null,
  "founderTitle": string | null,
  "nextGenName": string | null,
  "nextGenTitle": string | null,
  "quote": string | null,
  "rejectionReason": string | null
}
"quote" must be a short direct excerpt (<= 40 words) copied verbatim from the page text that best supports the decision — required when qualifies is true, null when false unless a quote explains the rejection well.`;

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

const DISPROVE_SYSTEM = `You are the skeptical second reviewer on a lead-qualification pipeline for The Goldhill Group. A first pass classified a company as showing a family-succession signal. Your job is to actively try to DISPROVE that classification using the same page text — look for reasons it's weaker than claimed (coincidental surname, no real title, language that's aspirational rather than descriptive, a already-completed transition with no current founder in seat, etc).

If your attempt to disprove it fails (the classification holds up), keep it, optionally softening confidence one notch if warranted. If you find a real reason it's weaker than claimed, downgrade confidence (e.g. high -> medium, medium -> verify) or reject it outright (holds: false) with a specific reason.

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
