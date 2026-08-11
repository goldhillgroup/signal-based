import { getSettingFresh, setSetting } from "../settings";
import { DEFAULT_ICP, normalizeIcp, type Icp } from "./icp-types";

/**
 * SERVER-ONLY half of the ideal-client profile. See ./icp-types.ts for what it
 * is and why it is a setting rather than a constant in a prompt.
 *
 * Stored as one JSON blob in `app_settings`, the same table and the same
 * service-role-only RLS the weekly schedule uses. Deliberately not a new table:
 * migrations here have to be pasted into the Supabase SQL editor by hand, so
 * one that can be avoided is worth avoiding.
 */

export const ICP_KEY = "IDEAL_CLIENT";

/**
 * Always returns a usable profile. A missing row, malformed JSON, or a field of
 * the wrong type all fall back to the default rather than throwing — this is
 * read at the top of every search, and the safe failure is "search the way the
 * product always did", never "the search button is broken".
 */
export async function getIcp(): Promise<Icp> {
  const raw = await getSettingFresh(ICP_KEY);
  if (!raw) return { ...DEFAULT_ICP };
  try {
    return normalizeIcp(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_ICP };
  }
}

export async function setIcp(next: Icp): Promise<Icp> {
  const clean = normalizeIcp(next);
  await setSetting(ICP_KEY, JSON.stringify(clean));
  return clean;
}
