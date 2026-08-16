/**
 * A folder's name, short enough to be a name.
 *
 * The label stored on a search is the query the user typed, and the form
 * builds that by listing every state chosen. Pick the twelve Jonathan
 * actually works and you get:
 *
 *   "family-owned companies in California, New York, New Jersey,
 *    Pennsylvania, Connecticut, Massachusetts, Rhode Island, New Hampshire,
 *    Vermont, Maine, Florida, Texas"
 *
 * which is a sentence, not a title. On a folder card it ran to six lines and
 * pushed the counts out of sight; as an <h1> it took three. Worse, every
 * folder for the same trade opens with the same forty characters, so the list
 * is unscannable exactly when it gets long.
 *
 * The shape is always "<subject> in <state, state, ...>", so the subject is
 * the name and the states are a count. The full query is still shown under the
 * heading on the folder page, so nothing is lost, it just stops being the
 * heading.
 *
 * Derived at RENDER, deliberately. Every folder already in the database has
 * the long label, and a migration to rewrite them would be a one-way edit of
 * the user's own text to fix what is really a display problem.
 */
export function folderTitle(label: string): string {
  const trimmed = label.trim();

  // Greedy up to the LAST " in ", so "companies in transition in California,
  // New York" keeps "companies in transition" as the subject rather than
  // splitting at the first one and calling "transition in California" a state.
  const m = trimmed.match(/^(.*)\s+in\s+(.+)$/i);
  if (!m) return trimmed;

  const subject = m[1].trim();
  const places = m[2]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // One or two places are shorter than "· 2 states" and more useful, since
  // they say WHICH. Only a list long enough to wrap is worth summarising.
  if (places.length < 3 || !subject) return trimmed;

  const head = subject.charAt(0).toUpperCase() + subject.slice(1);
  return `${head} · ${places.length} states`;
}
