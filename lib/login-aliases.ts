/**
 * Other spellings of Jonathan's email that sign in to the SAME account.
 *
 * WHY THIS EXISTS. "make jon, jonathan and d4nielm7 go to same account" --
 * a few ways of reaching one real Supabase user, jonathan@thegoldhillgroup.com.
 * Supabase authenticates on an exact email match, so any of these typed at
 * login would otherwise fail with the same "Invalid email or password" a
 * wrong password gives.
 *
 * A LOOKUP, NOT A SECOND ACCOUNT, and not a rename either. This app spent a
 * good part of today fighting Supabase's own email-change flow -- a
 * confirmation link to the new address, a rate limit between attempts, and
 * real uncertainty about which inbox would even see it. None of that is
 * needed for "log in under a few names": rewriting the typed address to the
 * canonical one before it reaches Supabase does the same job with no email,
 * no confirmation, and one password to ever keep current.
 *
 * NOT case- or whitespace-sensitive: a login field gets pasted into and
 * autocompleted, and a mismatch on capitalisation alone would fail the same
 * unhelpful way.
 */

const ALIASES: Record<string, string> = {
  // "goldhillgroup.com" (no "the") is the wrong domain -- it was in here
  // briefly and got pulled. The real one is thegoldhillgroup.com throughout.
  "jon@thegoldhillgroup.com": "jonathan@thegoldhillgroup.com",
  "d4nielm7@gmail.com": "jonathan@thegoldhillgroup.com",
};

/** What Supabase should actually be asked to authenticate, given what was typed. */
export function canonicalEmail(typed: string): string {
  const key = typed.trim().toLowerCase();
  return ALIASES[key] ?? typed.trim();
}
