/**
 * The signal focus a search was started with, recovered for its later passes.
 *
 * The first pass is given Jonathan's focus sentence (what a good lead looks like),
 * which steers both what discovery searches for and how each page is judged. The
 * passes after it were started with NO focus at all, so the sentence he had saved
 * shaped the first pass and was dropped for the rest of the search.
 *
 * The folder stores it in `query` as "<label>, <focus>" (see POST /api/search), so
 * it is recovered from there. If the folder has since been renamed the label is no
 * longer a prefix and the focus cannot be read back; the saved description, then
 * the default, stand in, which is also what the first pass used whenever nobody
 * typed a focus of their own.
 */
export function refinementForContinuation(args: {
  label: string | null | undefined;
  query: string | null | undefined;
  /** The saved LEAD_DESCRIPTION setting. */
  described?: string | null;
  /** The built-in default focus. */
  fallback: string;
}): string {
  const label = (args.label ?? "").trim();
  const query = (args.query ?? "").trim();
  if (label && query.startsWith(`${label}, `)) {
    const recovered = query.slice(label.length + 2).trim();
    if (recovered) return recovered;
  }
  return (args.described ?? "").trim() || args.fallback;
}
