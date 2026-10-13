import { personalContacts, reachesAPerson, type Company, type Contact } from "./company";

/**
 * One row per company, however many lists it appears in.
 *
 * Jonathan, 2026-10-13: "When I combine the exported files, I'm finding
 * duplicate records, which creates additional manual cleanup."
 *
 * Why there were duplicates, measured: the same company is stored once per
 * folder it was found in, by design, and re-checks plus "re-read everything"
 * searches were inserting it again every time. On the live database 110
 * domains appeared in more than one row, 14 of them as a QUALIFIED lead in
 * several lists, and acmewire.com eleven times. The inserting is fixed at the
 * source (see persistCompany in the orchestrator), but the rows already on file
 * remain, so every combined export collapses them here.
 *
 * What it keeps, and what it will not throw away:
 *   - the BEST row: a lead beats a cut, a founder-and-successor pair beats a
 *     plain fit, a stronger confidence beats a weaker one, one with a personal
 *     address beats one without, and the newest read breaks ties
 *   - every contact from every duplicate, so an address that was bought on the
 *     older row is not lost because the newer row won
 *   - his own note and 1-5 from any of them, if the winner has none
 *   - the names of the other lists it appeared in, so nothing is silent
 */

type Dedupable = Company & {
  listName?: string;
  ownGrade?: number | null;
  note?: string | null;
  /** The other lists this company also appeared in. Filled by dedupeCompanies. */
  alsoIn?: string;
};

/** "www.Example.com" and "example.com" are one company. */
export function domainKey(d: string | null | undefined): string {
  return (d ?? "").trim().toLowerCase().replace(/^www\./, "");
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, verify: 1 };

/** Higher is better. Compared field by field, most important first. */
function quality(c: Dedupable): number[] {
  return [
    c.status === "qualified" ? 1 : 0,
    c.hasSignal === true ? 1 : 0,
    CONFIDENCE_RANK[c.confidence ?? ""] ?? 0,
    personalContacts(c).length > 0 ? 1 : 0,
    new Date(c.lastCrawledAt || c.firstSeenAt || 0).getTime() || 0,
  ];
}

function better(a: Dedupable, b: Dedupable): boolean {
  const qa = quality(a);
  const qb = quality(b);
  for (let i = 0; i < qa.length; i++) {
    if (qa[i] !== qb[i]) return qa[i] > qb[i];
  }
  return false;
}

function mergeContacts(winner: Dedupable, losers: Dedupable[]): Pick<Company, "contact" | "backupContact" | "allContacts"> {
  const seen = new Set<string>();
  const merged: Contact[] = [];
  for (const c of [winner, ...losers]) {
    for (const k of c.allContacts ?? []) {
      if (!k.email) continue;
      const e = k.email.toLowerCase();
      if (seen.has(e)) continue;
      seen.add(e);
      merged.push(k);
    }
  }

  // The winner's own pick stands if it still reaches somebody; otherwise the
  // best personal address from any of the duplicates takes over.
  let contact = winner.contact;
  if (!reachesAPerson(contact)) {
    const personal = merged.find((k) => reachesAPerson(k));
    if (personal) contact = personal;
  }
  let backupContact = winner.backupContact;
  if (!backupContact?.email) {
    const shared = merged.find((k) => k.email && !reachesAPerson(k) && k.email !== contact?.email);
    if (shared) backupContact = shared;
  }
  return { contact, backupContact, allContacts: merged };
}

export interface DedupeResult<T> {
  rows: T[];
  /** How many rows were folded into another. */
  removed: number;
}

export function dedupeCompanies<T extends Dedupable>(companies: T[]): DedupeResult<T> {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const c of companies) {
    const k = domainKey(c.domain) || `id:${c.id}`;
    if (!groups.has(k)) {
      groups.set(k, []);
      order.push(k);
    }
    groups.get(k)!.push(c);
  }

  const rows: T[] = [];
  let removed = 0;
  for (const k of order) {
    const group = groups.get(k)!;
    if (group.length === 1) {
      rows.push(group[0]);
      continue;
    }
    let winner = group[0];
    for (const c of group) if (better(c, winner)) winner = c;
    const losers = group.filter((c) => c !== winner);
    removed += losers.length;

    const others = [...new Set(losers.map((l) => l.listName).filter((n): n is string => !!n && n !== winner.listName))];
    const noteFrom = winner.note ? null : losers.find((l) => l.note)?.note ?? null;
    const gradeFrom = winner.ownGrade ? null : losers.find((l) => l.ownGrade)?.ownGrade ?? null;

    rows.push({
      ...winner,
      ...mergeContacts(winner, losers),
      ...(noteFrom ? { note: noteFrom } : {}),
      ...(gradeFrom ? { ownGrade: gradeFrom } : {}),
      ...(others.length > 0 ? { alsoIn: others.join("; ") } : {}),
    });
  }
  return { rows, removed };
}
