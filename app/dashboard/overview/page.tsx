import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignalFunnel } from "@/components/SignalFunnel";
import { readHarvestHealth } from "@/lib/pipeline/preflight";
import { RadarIcon, FolderIcon, SettingsIcon, SearchIcon } from "@/components/icons";

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

  return {
    searches: searches.count ?? 0,
    scanned: scanned.count ?? 0,
    icpFit: icpFit.count ?? 0,
    signals: signals.count ?? 0,
    contacts: contacts.count ?? 0,
    spent,
  };
}

const DESTINATIONS = [
  { href: "/dashboard", icon: SearchIcon, label: "Run a search" },
  { href: "/dashboard/all-leads", icon: FolderIcon, label: "All leads" },
  { href: "/dashboard/settings", icon: SettingsIcon, label: "Settings" },
];

export default async function OverviewPage() {
  const [{ searches, scanned, icpFit, signals, contacts, spent }, health] = await Promise.all([
    getCounts(),
    readHarvestHealth(),
  ]);
  const rate = signals > 0 ? Math.round(scanned / signals) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <header>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
            <RadarIcon className="h-4 w-4" />
          </span>
          <h1 className="font-display text-xl font-semibold text-gh-ink">Overview</h1>
        </div>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-gh-ink-secondary">
          Family-owned landscapers and home builders where the founder is still
          in the seat and the next generation has already joined.
        </p>
      </header>

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

      <section>
        <SignalFunnel
          scanned={scanned}
          icpFit={icpFit}
          signals={signals}
          contacts={contacts}
        />
        {/* The one thing the diagram cannot say. */}
        <p className="mt-3 text-xs leading-relaxed text-gh-ink-secondary">
          <strong className="font-semibold text-gh-ink">Fit the ICP</strong> is
          the right kind of company.{" "}
          <strong className="font-semibold text-gh-ink">Real signal</strong> is
          a founder and their successor both named, both in charge today
          {rate ? ` — about 1 in ${rate}` : ""}. Rejections are kept with their
          reason, never deleted.
        </p>
      </section>

      <section>
        <div className="grid gap-3 sm:grid-cols-3">
          {DESTINATIONS.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="hover-spring group flex items-center gap-2.5 rounded-xl border border-gh-border bg-gh-surface px-4 py-3.5 hover:border-gh-sky/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold text-gh-ink group-hover:text-gh-navy">
                {label}
              </span>
            </Link>
          ))}
        </div>
        {/* Spend, stated plainly. Cost PER LEAD is the number that means
            something — a total is just a number until you know what it bought. */}
        <p className="mt-2.5 text-[11px] text-gh-ink-muted">
          {searches.toLocaleString("en-US")} searches run
          {spent > 0 && (
            <>
              {" · "}
              <span className="tabular font-medium text-gh-ink-secondary">
                ${spent.toFixed(2)} spent
              </span>
              {icpFit > 0 && ` · $${(spent / icpFit).toFixed(3)} per lead`}
            </>
          )}
          .
        </p>
      </section>
    </div>
  );
}
