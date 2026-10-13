/**
 * Candidates that were found and paid for but not read when a pass ended.
 *
 * WHY. A search runs as several passes, each a fresh function with an empty
 * queue. Two things were thrown away at the end of every pass: the candidates
 * discovery had already bought and nobody had read yet (about forty in a typical
 * simulated pass, three rounds of discovery), and, worse, the START of the next
 * pass, which began cold and stood idle for 36 to 145 seconds waiting for web
 * search before reading a single company. That is a third of a four-minute pass,
 * every pass. Carried over, the next pass starts reading at once and buys its
 * next rounds in the background.
 *
 * WHERE. In the settings table under `queue:<search id>`, because the database
 * cannot be given a new table from here (migrations are pasted by hand) and this
 * is a few kilobytes of short-lived state. It is read once, at the start of the
 * next pass, and cleared.
 *
 * It is never trusted: every entry is validated, anything stale is dropped, and
 * anything another search has settled in the meantime is dropped, so a bad or
 * old value can only cost the head start, never a wrong company.
 */
import type { Candidate } from "./apify";

export const QUEUE_KEY_PREFIX = "queue:";
/** Enough for a pass's leftovers, and a bound on what is stored. */
export const MAX_SAVED = 150;
/** Older than this is not carried: the next pass of a search starts within minutes. */
export const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export const queueKey = (searchId: string) => `${QUEUE_KEY_PREFIX}${searchId}`;

const CHANNELS = new Set(["maps", "web_search", "directory", "licensing"]);

/**
 * Re-checks are left out: they are chosen afresh from the database each pass, by
 * rules that change as rows are read, so a carried copy would only go stale.
 */
export function packQueue(candidates: Candidate[], now = Date.now()): string {
  const items = candidates
    .filter((c) => c.channel !== "recheck" && c.domain && c.url)
    .slice(0, MAX_SAVED)
    .map((c) => ({
      d: c.domain,
      u: c.url,
      t: c.title,
      c: c.channel,
      s: c.state ?? null,
      p: c.phone ?? null,
      y: c.city ?? null,
      a: c.address ?? null,
    }));
  return JSON.stringify({ at: now, items });
}

export function unpackQueue(raw: string | null | undefined, opts: { seen: Set<string>; now?: number }): Candidate[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rec = parsed as { at?: unknown; items?: unknown };
  const now = opts.now ?? Date.now();
  if (typeof rec?.at !== "number" || now - rec.at > MAX_AGE_MS || rec.at > now + 60_000) return [];
  if (!Array.isArray(rec.items)) return [];

  const out: Candidate[] = [];
  const claimed = new Set<string>();
  const str = (v: unknown) => (typeof v === "string" && v.length < 600 ? v : null);
  for (const it of rec.items.slice(0, MAX_SAVED) as Record<string, unknown>[]) {
    if (!it || typeof it !== "object") continue;
    const domain = str(it.d)?.toLowerCase();
    const url = str(it.u);
    const channel = str(it.c);
    if (!domain || !url || !channel || !CHANNELS.has(channel)) continue;
    // Settled by another search since, or already listed once.
    if (opts.seen.has(domain) || claimed.has(domain)) continue;
    claimed.add(domain);
    out.push({
      domain,
      url,
      title: str(it.t) ?? domain,
      channel: channel as Candidate["channel"],
      state: str(it.s),
      phone: str(it.p),
      city: str(it.y),
      address: str(it.a),
    });
  }
  return out;
}
