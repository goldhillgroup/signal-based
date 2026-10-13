/**
 * The note printed beside a list's counts, in words a person can act on.
 *
 * `searches.error_message` is where the pipeline records WHY a pass stopped, and
 * it was shown verbatim. On nearly every list that read "ran out of time before
 * it could read another batch", which is a log line rather than something said
 * to a client: it sounds like a fault, and it names no next step. Every one of
 * those runs had saved its results correctly and could simply be continued.
 */

const KNOWN: { test: RegExp; say: string }[] = [
  {
    test: /ran out of time before it could (read another batch|look for more companies)/i,
    say: "Stopped at the time limit for one pass. Everything found is saved, and it can carry on.",
  },
  {
    test: /^Stopped at the time limit after checking/i,
    // timeUpMessage() already writes a full sentence for the client.
    say: "",
  },
  {
    test: /Stopped early: this run hit the 5 minute server limit/i,
    say: "",
  },
];

/**
 * @returns the note to show, or null for nothing. An empty `say` means the
 * original message is already written for a client and is returned unchanged.
 */
export function friendlyNote(message: string | null | undefined): string | null {
  const raw = (message ?? "").trim();
  if (!raw) return null;
  for (const k of KNOWN) {
    if (k.test.test(raw)) return k.say || raw;
  }
  return raw;
}
