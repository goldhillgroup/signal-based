/** Rows per request. Smaller than PostgREST's own cap (1000), so a page is never cut short by it. */
export const PAGE_SIZE = 500;

/**
 * Read every row a query matches, a page at a time.
 *
 * PostgREST answers at most `max_rows` rows per request (1000 on Supabase unless
 * changed) and does not say it truncated, so a plain select silently drops the
 * tail once a table outgrows it. The companies table keeps every company ever
 * read, cut ones included, so it grows by hundreds of rows a day and was about
 * to cross that line (1,668 rows on 2026-10-13); a folder can now hold 1000 of
 * its own since searches may read that many.
 *
 * The query MUST have a deterministic order (end it with `.order("id")`), or rows
 * can repeat or go missing between pages.
 *
 * Returns null on any failure, so a half-read list is never passed off as whole.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>
): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error || !data) return null;
    out.push(...(data as T[]));
    if (data.length < PAGE_SIZE) return out;
  }
}
