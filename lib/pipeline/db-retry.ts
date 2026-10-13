/**
 * Retry a database call that failed for a TRANSIENT reason.
 *
 * Measured against this deployment: a cold Vercel instance occasionally cannot
 * reach Supabase at all for a moment, and every call in that window comes back
 * as a bare "fetch failed". The pipeline wrote company rows with no error check
 * and counted them as saved either way, so a failed write was both lost and
 * reported as a success.
 *
 * Only that failure shape is retried. A real rejection (a duplicate key, a
 * missing column, a constraint) fails identically every time, so retrying it
 * would only make the run slower.
 */

export interface DbResult<T> {
  data: T | null;
  error: { message?: string; code?: string } | null;
}

const TRANSIENT = /fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i;

export function isTransient(error: { message?: string } | null | undefined): boolean {
  return !!error && TRANSIENT.test(error.message ?? "");
}

export async function withDbRetry<T>(
  call: () => PromiseLike<DbResult<T>>,
  attempts = 3,
  waitMs = 250
): Promise<DbResult<T>> {
  let last: DbResult<T> = { data: null, error: { message: "not attempted" } };
  for (let i = 0; i < attempts; i++) {
    try {
      last = await call();
    } catch (e) {
      // supabase-js normally RETURNS the error; a thrown one is the transport.
      last = { data: null, error: { message: (e as Error).message } };
    }
    if (!last.error || !isTransient(last.error)) return last;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, waitMs * (i + 1)));
  }
  return last;
}

/** Postgres unique-violation. For a company row it means "already stored". */
export function isDuplicateKey(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? ""));
}
