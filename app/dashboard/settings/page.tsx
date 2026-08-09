import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { SettingsForm } from "@/components/SettingsForm";
import { VendorUsage } from "@/components/VendorUsage";
import { WeeklySchedule } from "@/components/WeeklySchedule";
import { getSchedule } from "@/lib/pipeline/schedule";

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
  const rows = await Promise.all(
    SETTINGS_KEYS.map(async ({ key, label, envFallback, what, logo, link, linkLabel, advanced }) => {
      const dbValue = await getSetting(key);
      const envValue = process.env[envFallback];
      return {
        key,
        label,
        what,
        logo,
        link,
        linkLabel,
        advanced,
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
          What each vendor has left, and the keys the search pipeline uses to
          get there.
        </p>
      </div>

      {/* Usage first, keys second. Keys get edited maybe once a month; "can I
          run another search today?" is the question this page actually gets
          opened for. */}
      <VendorUsage />

      {/* Above the keys: switching the schedule on is the decision that
          changes what this system spends, and it is the only control here
          that acts on its own. */}
      <WeeklySchedule initial={schedule} cronConfigured={Boolean(process.env.CRON_SECRET)} />

      <section>
        <h2 className="font-display text-lg font-semibold text-gh-ink">API keys</h2>
        <p className="mt-0.5 mb-3 text-sm text-gh-ink-secondary">
          Saved here take effect on the very next search, no redeploy needed.
          Leave a field blank to keep whatever&apos;s already set.
        </p>
        <SettingsForm rows={rows} />
      </section>
    </div>
  );
}
