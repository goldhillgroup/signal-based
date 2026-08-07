import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { SettingsForm } from "@/components/SettingsForm";
import { VendorUsage } from "@/components/VendorUsage";

// Server component on purpose — it's the only place allowed to see a real
// key value (via getSetting, service-role only). Everything handed to the
// client form below is a masked display string; the raw value never leaves
// this function. Passing a real secret as a prop to a Client Component
// would serialize it into the page's RSC payload regardless of how
// carefully the server-side fetch was scoped — masking has to happen here,
// not in the browser.
function mask(value: string): string {
  if (value.length <= 4) return "••••";
  return `••••••••${value.slice(-4)}`;
}

export default async function SettingsPage() {
  const rows = await Promise.all(
    SETTINGS_KEYS.map(async ({ key, label, envFallback }) => {
      const dbValue = await getSetting(key);
      const envValue = process.env[envFallback];
      return {
        key,
        label,
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

      <section>
        <h2 className="font-display text-lg font-semibold text-gh-ink">API keys</h2>
        <p className="mt-0.5 mb-3 text-sm text-gh-ink-secondary">
          Saved here take effect on the very next search — no redeploy needed.
          Leave a field blank to keep whatever&apos;s already set.
        </p>
        <SettingsForm rows={rows} />
      </section>
    </div>
  );
}
