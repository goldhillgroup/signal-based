import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignalFunnel } from "@/components/SignalFunnel";
import { readHarvestHealth } from "@/lib/pipeline/preflight";
import { getSchedule } from "@/lib/pipeline/schedule";
import { DAY_NAMES } from "@/lib/pipeline/schedule-types";
import { RecentFolders } from "@/components/RecentFolders";
import { RadarIcon, SettingsIcon } from "@/components/icons";
import { HeroStats } from "@/components/HeroStats";

/**
 * Orientation page — what this found, and where to go.
 *
 * Rewritten to be a diagram plus three links. The first version explained the
 * pipeline in four paragraphs and the qualified/signal distinction in another
 * ninety words; the funnel says both by SHAPE — each number smaller than the
 * one before it — and a single line underneath carries the only sentence that
 * the picture cannot.
 *
 * Server component: five head-only counts, no rows over the wire.
 */

export const dynamic = "force-dynamic";

async function getCounts() {
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };

  const [searches, scanned, icpFit, signals, contacts, costs] = await Promise.all([
    supabase.from("searches").select("*", head),
    supabase.from("companies").select("*", head),
    supabase.from("companies").select("*", head).eq("status", "qualified"),
    supabase.from("companies").select("*", head).eq("has_signal", true),
    supabase.from("contacts").select("*", head).not("email", "is", null),
    // Not head-only — this one needs the values, not the count.
    supabase.from("searches").select("cost_estimate_usd"),
  ]);

  const spent = (costs.data ?? []).reduce(
    (n, r) => n + (typeof r.cost_estimate_usd === "number" ? r.cost_estimate_usd : 0),
    0
  );

  const { data: recent } = await supabase
    .from("searches")
    .select("id, label, created_at, status, qualified_count, verify_count, fit_only_count, rejected_count, cost_estimate_usd")
    .order("created_at", { ascending: false })
    .limit(4);

  return {
    recent: recent ?? [],
    searches: searches.count ?? 0,
    scanned: scanned.count ?? 0,
    icpFit: icpFit.count ?? 0,
    signals: signals.count ?? 0,
    contacts: contacts.count ?? 0,
    spent,
  };
}


export default async function OverviewPage() {
  const [{ recent, searches, scanned, icpFit, signals, contacts, spent }, health, schedule] =
    await Promise.all([getCounts(), readHarvestHealth(), getSchedule()]);
  const rate = signals > 0 ? Math.round(scanned / signals) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      {/* HEADLINE, NOT AN ESSAY.
          This opened with two sentences describing the ICP and put every
          number a screen below them. Backwards for a page called Overview: the
          question on arrival is "where do things stand", the answer is a
          number, and prose that must be read first is a toll booth. The ICP
          description now lives where it is actually needed — on the search
          form, next to the fields that set it. */}
      <header className="fade-up flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gh-navy text-white">
            <RadarIcon className="h-4.5 w-4.5" />
            {/* Slow halo. The only always-on motion on the page, on the one
                mark that stands for the product itself. */}
            <span
              aria-hidden
              className="pulse-ring absolute inset-0 rounded-xl border border-gh-sky"
            />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold leading-none text-gh-ink">
              Overview
            </h1>
            <p className="mt-1 text-[11px] text-gh-ink-muted">
              {searches > 0
                ? `${searches} search${searches === 1 ? "" : "es"} run so far`
                : "Nothing run yet"}
            </p>
          </div>
        </div>

        {/* No "New search" button here: the Topbar carries one, four inches
            up and to the right, and two identical primary buttons on one
            screen makes neither read as the primary. */}
      </header>

      {/* Deliberately NOT the funnel's numbers. The funnel below already shows
          read -> fit -> signals -> contacts, and repeating three of them up
          here was the single biggest reason this page felt like noise. These
          are the four things the funnel structurally cannot say. */}
      <HeroStats
        stats={[
          {
            label: "Reachable",
            value: contacts,
            hint: "leads with an email found",
            accent: "var(--gh-cat-3)",
          },
          {
            label: "Hit rate",
            value: rate ?? 0,
            prefix: "1 in ",
            hint: rate ? "companies read per signal" : "no signals yet",
            accent: "var(--gh-cat-2)",
          },
          {
            label: "Spent",
            value: spent,
            prefix: "$",
            decimals: 2,
            hint: `across ${searches} search${searches === 1 ? "" : "es"}`,
            accent: "var(--gh-cat-4)",
          },
          {
            label: "Per lead",
            value: icpFit > 0 ? spent / icpFit : 0,
            prefix: "$",
            decimals: 3,
            hint: "what each one cost",
            accent: "var(--gh-cat-1)",
          },
        ]}
      />

      {/* A scheduled run that could not happen must SAY SO. Without this, a
          harvest blocked on exhausted credit looks identical to a quiet week —
          the system reporting "no leads" when the truth is "I never looked".
          Only rendered when something went wrong; a healthy cron stays silent. */}
      {health && !health.ok && (
        <div className="rounded-xl border border-gh-warning/60 bg-gh-warning/10 p-4">
          <p className="text-xs font-semibold text-gh-ink">Last scheduled run did not go ahead</p>
          <p className="mt-1 text-xs leading-relaxed text-gh-ink-secondary">{health.reason}</p>
          <p className="mt-1 text-[11px] text-gh-ink-muted">
            {new Date(health.at).toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            })}
          </p>
        </div>
      )}

      <section className="fade-up">
        <SignalFunnel
          scanned={scanned}
          icpFit={icpFit}
          signals={signals}
          contacts={contacts}
        />
        {/* The 90-word explainer that lived here is gone. The funnel shows the
            shape, the tiles carry the rate, and "1 in 33" says what a
            paragraph was saying at length. */}
      </section>

      {/* What actually happened, not just totals. */}
      <section>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="font-display text-sm font-semibold text-gh-ink">Recent searches</h2>
          {searches > 0 && (
            <Link href="/dashboard/all-leads" className="text-[11px] font-semibold text-gh-sky hover:underline">
              All leads
            </Link>
          )}
        </div>
        <RecentFolders rows={recent} />
      </section>

      {/* Whether anything runs on its own, answered without opening Settings. */}
      <section>
        <div className="fade-up flex items-center gap-3 rounded-xl border border-gh-border bg-gh-surface px-4 py-3.5" style={{ animationDelay: "240ms" }}>
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              schedule.enabled ? "bg-gh-lime/20 text-[#5f8a00]" : "bg-gh-surface-sunken text-gh-ink-muted"
            }`}
          >
            <SettingsIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-gh-ink">
              Weekly harvest is {schedule.enabled ? "on" : "off"}
            </span>
            <span className="mt-0.5 block text-[11px] text-gh-ink-muted">
              {schedule.enabled
                ? `Runs every ${DAY_NAMES[schedule.dayOfWeek]}, ${schedule.industries.length} vertical${schedule.industries.length === 1 ? "" : "s"} across ${schedule.states.length} state${schedule.states.length === 1 ? "" : "s"}.`
                : "Nothing runs on its own. Searches happen when you ask."}
            </span>
          </span>
          <Link
            href="/dashboard/settings"
            className="shrink-0 rounded-lg border border-gh-border px-3 py-1.5 text-[11px] font-semibold text-gh-ink-secondary transition-colors duration-200 hover:border-gh-sky/40 hover:text-gh-ink"
          >
            {schedule.enabled ? "Change" : "Turn on"}
          </Link>
        </div>
      </section>

      {/* The three quick-link cards that sat here are gone. They were "Run a
          search", "All leads" and "Settings" — the sidebar, rendered a second
          time, four inches below the sidebar. So was the spend line under
          them, which repeated the searches count and the per-lead figure the
          tiles already carry.

          Seen side by side in a screenshot, this page was saying its numbers
          three times: tiles, then the funnel, then a footer. Cutting the
          repeats is what made it visual — not more decoration, less of the
          same thing. */}
    </div>
  );
}
