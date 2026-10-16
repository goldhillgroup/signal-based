/**
 * Whose account is this key tied to? One line per vendor, for the Settings cards.
 *
 * WHY. A top-up went to one OpenRouter login while the key in Signal Radar belonged to
 * another, and nobody could say which was which (2026-10-14). The vendors differ in what
 * they will tell you, so each card says what its vendor actually reveals (an email, an
 * account name, a plan, a user ID) and, where a vendor reveals nothing about the owner,
 * says THAT plainly and shows the key's last four characters, which is what to look for in
 * the vendor's own key list. Never the whole key.
 */

/** The last four characters of a key, or "" when it is too short to mean anything. */
export function tailOf(key: string | null | undefined): string {
  return key && key.length >= 8 ? key.slice(-4) : "";
}

const ending = (tail: string) => (tail ? `key ending …${tail}` : "no usable key saved");

export function accountForOpenRouter(
  info: { creator_user_id?: string | null; organization_id?: string | null } | null,
  tail: string
): string {
  const parts: string[] = [];
  if (info?.creator_user_id) parts.push(`OpenRouter user ${info.creator_user_id}`);
  if (info?.organization_id) parts.push(`organization ${info.organization_id}`);
  parts.push(ending(tail));
  return parts.join(" · ");
}

export function accountForApify(
  me: { username?: string | null; email?: string | null; profile?: { name?: string | null } | null; plan?: { id?: string | null } | null } | null,
  tail: string
): string {
  const parts: string[] = [];
  if (me?.email) parts.push(me.email);
  if (me?.username) parts.push(`account “${me.username}”${me.profile?.name ? ` (${me.profile.name})` : ""}`);
  if (me?.plan?.id) parts.push(`${titleCase(me.plan.id)} plan`);
  parts.push(ending(tail));
  return parts.join(" · ");
}

export function accountForEmail(email: string | null | undefined, tail: string): string {
  return email ? `${email} · ${ending(tail)}` : accountForUnknownOwner("this vendor", tail);
}

/** For a vendor whose API says nothing about who owns the account. */
export function accountForUnknownOwner(vendor: string, tail: string, extra?: string | null): string {
  return `Owner not shown by ${vendor} · ${ending(tail)}${extra ? ` · ${extra}` : ""}`;
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();
}
