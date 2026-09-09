import type { createServiceRoleClient } from "./supabase/server";

/**
 * Jonathan's own notes and his own 1-5, per lead.
 *
 * WHY NOT COLUMNS ON `companies`. Because I cannot add them. This app holds a
 * PostgREST key, PostgREST does not execute DDL, there is no Supabase CLI or
 * access token on the machine, and the service-role key is rejected by the
 * management API. Two features had already been stalled waiting for somebody
 * to paste a migration.
 *
 * WHY THIS IS NOT A WORKAROUND. `app_settings` is `key text primary key, value
 * text` with nothing constraining the key, which is a key-value store. A note
 * against a company id is key-value data. Using it as one is the ordinary use
 * of the table, not a trick played on it -- unlike the earlier attempt to keep
 * PEOPLE in `contacts`, which bent a table about addresses into holding
 * something else and cost two bugs.
 *
 *   note:<companyId>    free text
 *   grade:<companyId>   "1".."5", Jonathan's own
 *
 * One row per value, so a note is written without rewriting every other note,
 * and the primary-key index makes the prefix read a range scan.
 *
 * WHAT IT CANNOT DO: sort or filter inside a database query. Everything is
 * loaded in one prefix read and merged in memory, which is fine at 450 leads
 * and would not be at 450,000. If this outgrows that, the answer is the column
 * it should have been, and the migration is a one-line insert-select.
 */

type Db = ReturnType<typeof createServiceRoleClient>;

const NOTE = "note:";
const GRADE = "grade:";

export interface LeadMarks {
  note: string | null;
  /** Jonathan's own 1-5. Beats the system's, which is the point of having it. */
  grade: number | null;
}

function cleanGrade(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

/** Every note and grade, keyed by company id. One read. */
export async function loadMarks(db: Db): Promise<Record<string, LeadMarks>> {
  const [notes, grades] = await Promise.all([
    db.from("app_settings").select("key, value").like("key", `${NOTE}%`),
    db.from("app_settings").select("key, value").like("key", `${GRADE}%`),
  ]);

  const out: Record<string, LeadMarks> = {};
  for (const r of notes.data ?? []) {
    const id = r.key.slice(NOTE.length);
    out[id] = { note: r.value || null, grade: out[id]?.grade ?? null };
  }
  for (const r of grades.data ?? []) {
    const id = r.key.slice(GRADE.length);
    out[id] = { note: out[id]?.note ?? null, grade: cleanGrade(r.value) };
  }
  return out;
}

export async function loadMarksFor(db: Db, companyId: string): Promise<LeadMarks> {
  const { data } = await db
    .from("app_settings")
    .select("key, value")
    .in("key", [`${NOTE}${companyId}`, `${GRADE}${companyId}`]);
  const marks: LeadMarks = { note: null, grade: null };
  for (const r of data ?? []) {
    if (r.key.startsWith(NOTE)) marks.note = r.value || null;
    else marks.grade = cleanGrade(r.value);
  }
  return marks;
}

/**
 * Write one lead's marks.
 *
 * An empty note DELETES its row rather than storing "". A blank string is not
 * a note, and leaving one behind means a prefix read returns rows that carry
 * nothing.
 */
export async function saveMarks(
  db: Db,
  companyId: string,
  patch: { note?: string | null; grade?: number | null }
): Promise<{ error?: string }> {
  if (patch.note !== undefined) {
    const text = (patch.note ?? "").trim().slice(0, 4000);
    if (text) {
      const { error } = await db
        .from("app_settings")
        .upsert({ key: `${NOTE}${companyId}`, value: text, updated_at: new Date().toISOString() });
      if (error) return { error: error.message };
    } else {
      await db.from("app_settings").delete().eq("key", `${NOTE}${companyId}`);
    }
  }

  if (patch.grade !== undefined) {
    const g = cleanGrade(patch.grade);
    if (g === null) {
      await db.from("app_settings").delete().eq("key", `${GRADE}${companyId}`);
    } else {
      const { error } = await db
        .from("app_settings")
        .upsert({ key: `${GRADE}${companyId}`, value: String(g), updated_at: new Date().toISOString() });
      if (error) return { error: error.message };
    }
  }
  return {};
}
