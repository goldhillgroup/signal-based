/**
 * Is this a plausible API key, before it is saved?
 *
 * WHY. On 2026-10-14 the OpenRouter key in Settings was overwritten with the two
 * characters "25", almost certainly the amount of a top-up typed into the key box.
 * Everything that spends through OpenRouter then failed with HTTP 401, the
 * Settings card said only "vendor returned HTTP 401", and the real key, which had
 * been working the day before, was gone: nothing had checked the value, and the
 * old one was overwritten. A key is long and has no spaces, and an OpenRouter key
 * says what it is; these cheap checks catch a wrong paste before it replaces a
 * working key. The route also asks OpenRouter itself whether the key is accepted.
 */

/** Real keys here run 24 to 70+ characters; nothing legitimate is shorter than this. */
export const MIN_KEY_LENGTH = 16;

export function validateSecret(key: string, raw: string): string | null {
  const value = raw.trim();
  if (value.length < MIN_KEY_LENGTH) {
    return (
      `That is only ${value.length} character${value.length === 1 ? "" : "s"}, so it is not an API key ` +
      `(keys are long strings of letters and numbers). Paste the whole key from the vendor's dashboard, ` +
      `not an amount or a code. Nothing was saved, and the key that was here is untouched.`
    );
  }
  if (/\s/.test(value)) {
    return "That contains a space or a line break, so it is not a single API key. Paste just the key. Nothing was saved.";
  }
  if (key === "OPENROUTER_API_KEY" && !value.startsWith("sk-or-")) {
    return (
      "An OpenRouter key starts with sk-or-. Create one at openrouter.ai/settings/keys while signed in to the " +
      "account that holds the credits. Nothing was saved, and the key that was here is untouched."
    );
  }
  return null;
}
