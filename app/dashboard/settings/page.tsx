import { getSetting, SETTINGS_KEYS } from "@/lib/settings";
import { ReplayTourButton } from "@/components/DashboardTour";
import { SettingsForm } from "@/components/SettingsForm";

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

  // The Apify row shows the client's own $29 plan, full stop.
  //
  // This used to resolve which of TWO accounts was actually spending, because
  // getApifyToken tried a developer's token first and the page would otherwise
  // have reported $29 of headroom on an account that was not being charged.
  // That fallback is deleted, so there is one account, and no branch.
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
        usageId,
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
      {/* Somebody who skipped the tour, or a second person on the shared
          login, needs a way back to it. The flag it clears is per-browser. */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gh-border bg-gh-surface px-4 py-3.5">
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-gh-ink">New to this?</span>
          <span className="mt-0.5 block text-[11px] text-gh-ink-muted">
            A ninety-second walk through the five screens and what each is for.
          </span>
        </span>
        <ReplayTourButton />
      </div>

    </div>
  );
}
