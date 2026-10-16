/**
 * Which OpenRouter account a saved key is tied to, as far as OpenRouter will say.
 *
 * It will not say the login email: the API has no such field. What it does give is the
 * key's own name, a spend limit if one is set, and the account's balance, which together
 * identify the account to anyone who can sign in to OpenRouter and look at their key list
 * (it shows each key's name and last characters). Written after a top-up went to one
 * OpenRouter login while the key in Signal Radar belonged to another, and nobody could
 * tell which was which.
 */

export interface OpenRouterKeyInfo {
  /** The key's name in OpenRouter, or an auto-generated masked label such as "sk-or-v1-abc...xyz". */
  label?: string | null;
  limit?: number | null;
  limit_remaining?: number | null;
  is_free_tier?: boolean | null;
  creator_user_id?: string | null;
  organization_id?: string | null;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The last four characters of the key saved here, never more. */
export function keyTail(key: string): string {
  return key.length >= 8 ? key.slice(-4) : "";
}

export function describeOpenRouterKey(info: OpenRouterKeyInfo | null, tail: string): string[] {
  const out: string[] = [];
  const label = (info?.label ?? "").trim();
  // OpenRouter labels an unnamed key with a masked copy of it; that is not a name.
  const named = label && !/^sk-or-/i.test(label);
  const ending = tail ? ` ending …${tail}` : "";
  out.push(named ? `Key in use: “${label}”${ending}.` : `Key in use: an unnamed key${ending}.`);
  if (info?.is_free_tier) out.push("This account is on the free tier.");
  if (typeof info?.limit === "number" && typeof info?.limit_remaining === "number") {
    out.push(`This key has its own spend limit of ${usd(info.limit)} (${usd(info.limit_remaining)} left).`);
  }
  out.push(
    "OpenRouter does not reveal the login email. To see which account this is, sign in at openrouter.ai/settings/keys: " +
      `the account that lists a key${ending} is the one Signal Radar bills, and that account's Credits page is where to top up.`
  );
  return out;
}

/** What the card says about a key OpenRouter refused: enough to see at a glance that it is the wrong value. */
export function describeRejectedKey(key: string): string[] {
  const tail = keyTail(key);
  const shape = key.startsWith("sk-or-") ? "" : " and does not start with sk-or-";
  return [
    `The key saved here is ${key.length} character${key.length === 1 ? "" : "s"}${tail ? `, ending …${tail}` : ""}${shape}. ` +
      "A real OpenRouter key is about 70 characters and starts sk-or-.",
  ];
}
