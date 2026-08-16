import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignalFunnel } from "@/components/SignalFunnel";
import { RecentFolders } from "@/components/RecentFolders";
import { RadarIcon } from "@/components/icons";
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

  // EVERY count here is scoped to companies that still belong to a folder.
  //
  // Unscoped, these counted the whole table — including the 149 companies that
  // reset-leads.mts DETACHED to preserve cross-search memory. Those rows are
  // deliberately unreachable: every lead surface drops `!c.searchId`. So the
  // Overview announced "Fit the ICP 80" and "Real signals 31" while the only
  // folder in the product held 28 and 15, and its tiles linked to a page that
  // contradicted them with no route to the difference.
  //
  // The funnel is a claim about what Jonathan HAS. Memory he cannot open is
  // not that, however real it is to the crawler.
  const attached = () => supabase.from("companies").select("*", head).not("search_id", "is", null);

  // HAND-AUDITED ROWS ARE EXCLUDED FROM THE RATE, and this is the number that
  // most flattered itself.
  //
  // "Hit rate — companies read per signal" counted Jonathan's own 28
  // hand-verified leads among the signals while counting the 67 companies of
  // his proof list among those read. The crawler never read any of them: he
  // did, by hand, before it existed. Mixing his work into a measurement of the
  // machine's showed 1 in 12 where the machine's real figure is 1 in 47 — the
  // headline stat on the first page anyone opens, overstating the product by
  // roughly four times.
  //
  // Everything else on this page still counts them, correctly: they ARE leads,
  // they ARE reachable, and he should see them. Only the rate is a claim about
  // how well the crawler performs, and only the crawler belongs in it.
  const crawled = () => attached().neq("discovery_channel", "hand_audit");

  const [searches, scanned, icpFit, signals, contacts, costs, crawledRead, crawledSignals] =
    await Promise.all([
    supabase.from("searches").select("*", head),
    attached(),
    attached().eq("status", "qualified"),
    attached().eq("has_signal", true),
    // find_status too: a 'not_attempted' row is an address scraped free off the
    // page at classify time, not one that was looked up. Counting them under
    // "leads with an email found" overstated the vendor's yield by 35%.
    supabase
      .from("contacts")
      .select("*, companies!inner(search_id)", head)
      .not("email", "is", null)
      .neq("find_status", "not_attempted")
      .not("companies.search_id", "is", null),
    // Not head-only — this one needs the values, not the count.
    supabase.from("searches").select("cost_estimate_usd"),
    crawled(),
    crawled().eq("has_signal", true),
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
    crawledRead: crawledRead.count ?? 0,
    crawledSignals: crawledSignals.count ?? 0,
    contacts: contacts.count ?? 0,
    spent,
  };
}


export default async function OverviewPage() {
  const { recent, searches, scanned, icpFit, signals, crawledRead, crawledSignals, contacts, spent } =
    await getCounts();
  // The crawler's own rate. See getCounts for why the hand-audited list is out.
  const rate = crawledSignals > 0 ? Math.round(crawledRead / crawledSignals) : null;

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
            hint: rate ? "companies the crawler reads per signal" : "no signals yet",
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
