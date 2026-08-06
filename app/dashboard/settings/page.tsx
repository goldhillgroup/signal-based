import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { SettingsForm } from "@/components/SettingsForm";

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
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-gh-ink">Settings</h1>
        <p className="mt-1 text-sm text-gh-ink-secondary">
          API keys the search pipeline uses. Saved here take effect on the very
          next search — no redeploy needed. Leave a field blank to keep
          whatever&apos;s already set.
        </p>
      </div>
      <SettingsForm rows={rows} />
    </div>
  );
}
