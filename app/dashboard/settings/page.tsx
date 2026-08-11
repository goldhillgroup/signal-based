import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { SettingsForm } from "@/components/SettingsForm";
import { WeeklySchedule } from "@/components/WeeklySchedule";
import { getSchedule } from "@/lib/pipeline/schedule";
import { getIcp } from "@/lib/pipeline/icp";
import { IdealClient } from "@/components/IdealClient";

// Server component on purpose — it's the only place allowed to see a real
// key value (via getSetting, service-role only). Everything handed to the
// client form below is a masked display string; the raw value never leaves
// this function. Passing a real secret as a prop to a Client Component
// would serialize it into the page's RSC payload regardless of how
// carefully the server-side fetch was scoped — masking has to happen here,
// not in the browser.
// Never served from a cached render — this page shows live vendor balances
// and a schedule that must reflect the last save, not a snapshot.
export const dynamic = "force-dynamic";

function mask(value: string): string {
  if (value.length <= 4) return "••••";
  return `••••••••${value.slice(-4)}`;
}

export default async function SettingsPage() {
  const schedule = await getSchedule();
  const icp = await getIcp();

  /**
   * Which Apify balance to show against the one Apify key row.
   *
   * SETTINGS_KEYS pins it to "apify-1", the client's own $29 plan. But
   * getApifyToken() tries APIFY_TOKEN_4 FIRST and only falls through to the
   * client's token when that is unset — so while the dev account is in play,
   * the page reported $29 of headroom on an account that is not spending,
   * while the token that IS spending would refuse at its own $14 ceiling.
   * A balance that belongs to a different account than the one being charged
   * is worse than no balance.
   *
   * Resolved the same way the pipeline resolves it, so the two cannot disagree.
   * In production APIFY_TOKEN_4 is absent and this lands back on "apify-1",
   * which is the intended end state.
   */
  const apifyDevActive = Boolean(
    (await getSetting("APIFY_TOKEN_4")) ?? process.env.APIFY_TOKEN_4
  );
  const rows = await Promise.all(
    // usageId included. It was dropped here while SettingsForm keys the entire
    // balance panel off it, so every row arrived with usageId === undefined and
    // no vendor balance has ever rendered on this page — not even the
    // "Balance unavailable" fallback, which was unreachable for the same reason.
    SETTINGS_KEYS.map(async ({ key, label, envFallback, what, logo, link, linkLabel, usageId }) => {
      const dbValue = await getSetting(key);
      const envValue = process.env[envFallback];
      return {
        key,
        label,
        what,
        logo,
        link,
        linkLabel,
        usageId: key === "APIFY_TOKEN" && apifyDevActive ? "apify-4" : usageId,
        status: dbValue
          ? ("db" as const)
          : envValue
            ? ("env" as const)
            : ("unset" as const),
        masked: dbValue ? mask(dbValue) : envValue ? mask(envValue) : null,
      };
    })
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-gh-ink">Settings</h1>
        <p className="mt-1 text-sm text-gh-ink-secondary">
          Everything the pipeline needs to keep running, in one place.
        </p>
      </div>

      {/* FIRST, above both the schedule and the keys. The keys keep the
          product running; this decides what it goes looking for. */}
      <IdealClient initial={icp} />

      {/* Above the keys: switching the schedule on is the decision that
          changes what this system spends, and it is the only control here
          that acts on its own. */}
      <WeeklySchedule initial={schedule} cronConfigured={Boolean(process.env.CRON_SECRET)} />

      {/* ONE list, not two. Balances and keys were separate sections on this
          page, so "Apify is empty, where do I paste the new token" meant
          scrolling between two lists that never referred to each other. Each
          vendor is now a single card: what it does, what it has left, and the
          field that fixes it. */}
      <section>
        <h2 className="font-display text-lg font-semibold text-gh-ink">Vendors</h2>
        <p className="mt-0.5 mb-3 text-sm text-gh-ink-secondary">
          What each one has left, and the key it uses. A key saved here takes
          effect on the very next search, no redeploy. Leave a field blank to
          keep whatever is already set.
        </p>
        <SettingsForm rows={rows} />
      </section>
    </div>
  );
}
