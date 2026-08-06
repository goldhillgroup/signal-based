import { resolveSetting } from "../settings";

const BASE = "https://api.anymailfinder.com/v5.0";

// Editable from /dashboard/settings (DB value wins, falls through to the
// env var) — see lib/settings.ts.
async function getApiKey(): Promise<string> {
  const key = await resolveSetting("ANYMAILFINDER_API_KEY", process.env.ANYMAILFINDER_API_KEY);
  if (!key) throw new Error("ANYMAILFINDER_API_KEY is not set");
  return key;
}

export interface ContactFindResult {
  found: boolean;
  email: string | null;
  name: string | null;
  nameInferred: boolean;
}

// Read a plausible first name off an email handle for the fallback case —
// same technique the original proof used ("mike@company.com" -> "Mike").
function inferNameFromEmail(email: string): string | null {
  const local = email.split("@")[0];
  const first = local.split(/[._-]/)[0];
  if (!first || first.length < 2 || /^\d+$/.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

async function post(path: string, body: Record<string, unknown>) {
  const apiKey = await getApiKey();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Primary path — a named next-gen leader. Falls back to "any owner/manager
// email at this domain" + email-handle name inference when the page named no
// one (per scope: the Kessler & Sons / "mike@..." case).
export async function findContact(domain: string, fullName: string | null): Promise<ContactFindResult> {
  if (fullName) {
    const { ok, data } = await post("/search/person.json", { domain, full_name: fullName });
    if (ok && data?.success && data?.results?.email) {
      return { found: true, email: data.results.email, name: fullName, nameInferred: false };
    }
  }

  // Fallback: any email at the domain, name inferred from the handle.
  const { ok, data } = await post("/search/company.json", { domain });
  if (ok && data?.success) {
    const emails: string[] = data?.results?.emails ?? [];
    const first = emails[0];
    if (first) {
      return { found: true, email: first, name: inferNameFromEmail(first), nameInferred: true };
    }
  }

  return { found: false, email: null, name: null, nameInferred: false };
}
