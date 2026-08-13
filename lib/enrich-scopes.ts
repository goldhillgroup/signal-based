import type { Company } from "./company";
import { isWrongKindOfBusiness } from "./pipeline/recheck-policy";

/**
 * Who to look up an email for — THREE CHOICES, EVERYWHERE, ALWAYS.
 *
 * There are three places to start enrichment: the "Ready for you" panel, the
 * folder page, and the Enrichment page. All three had a different idea of what
 * you were asking for, and two of them decided for you:
 *
 *   Ready for you   no scope, no confirmation. An absent scope reads as
 *                   "signals" server-side, so on a folder with no pair it
 *                   looked up NOTHING and reported success.
 *   Folder page     no scope either, same silent default.
 *   Enrichment page two options — the pairs, or everything that fits.
 *
 * None offered the fits ON THEIR OWN, which is the one you want second: having
 * called the pairs, the next question is the rest of the list, not the whole
 * list again.
 *
 * So the scopes are DISJOINT and they match the three tabs a folder already
 * shows. What you can enrich is the same shape as what you were just looking
 * at, and picking all three in turn costs exactly what picking the union costs
 * — no overlap, nothing bought twice.
 *
 * Client-safe: imported by three Client Components, so nothing here may reach
 * lib/supabase/server.
 */
export interface EnrichScope {
  key: "pairs" | "fits" | "everything";
  label: string;
  hint: string;
  ids: string[];
}

export function enrichScopesFor(companies: Company[]): EnrichScope[] {
  const pairs = companies.filter((c) => c.status === "qualified" && c.hasSignal === true);
  // The fits ALONE. Not "leads including pairs" — that was the old middle
  // option and it made the second click re-buy the first.
  const fits = companies.filter((c) => c.status === "qualified" && c.hasSignal !== true);
  // Cut companies worth arguing with. Excludes the ones hidden from the "Not a
  // fit" tab as a different KIND of business — a funeral home has no founder to
  // ring, and offering to look one up would be spending on a decision nobody
  // disputes.
  const cut = companies.filter(
    (c) => c.status === "rejected" && !isWrongKindOfBusiness(c.rejectionReason)
  );

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  return [
    {
      key: "pairs",
      label: `Only the ${pairs.length} ${plural(pairs.length, "pair", "pairs")}`,
      hint: "Founder and successor both named and running it today",
      ids: pairs.map((c) => c.id),
    },
    {
      key: "fits",
      label: `Only the ${fits.length} ${plural(fits.length, "fit", "fits")}`,
      hint: "Fits the profile, but no successor is named yet",
      ids: fits.map((c) => c.id),
    },
    {
      key: "everything",
      label: `Everything, including the ${cut.length} cut`,
      hint: "Also the companies cut on a gate you might disagree with",
      ids: [...pairs, ...fits, ...cut].map((c) => c.id),
    },
  ];
}
