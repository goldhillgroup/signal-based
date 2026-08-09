"use client";

import { useMemo, useState } from "react";
import { Company } from "@/lib/company";
import { INDUSTRY_META } from "@/lib/signal-meta";
import type { Industry } from "@/lib/supabase/types";
import { scoreFactors, signalTypeOf, SIGNAL_TYPE_META, type SignalType } from "@/lib/lead-signal";
import { SearchIcon, GridIcon, RowsIcon } from "./icons";
import { LeadCard } from "./LeadCard";
import { LeadTable } from "./LeadTable";

type Tab = "all" | "signal";

// FOUR TABS BECAME TWO, and they now say what the cards say.
//
// They were All / Qualified / Verify / Fit only — internal vocabulary, printed
// on the front of the product. "Qualified" and "Fit only" are indistinguishable
// to anyone who has not read the classifier, and worse, the cards below had
// already been relabelled to "Succession pair", "Needs a look" and
// "Family-owned fit", so the same company was called two different things three
// inches apart.
//
// Two also matches the data. A real folder ran 1 pair / 2 verify / 26 fit-only,
// so three of the four tabs held single digits — segmentation that costs a
// click to reach a list of one. The fine split still exists: grouping (default
// "By signal") separates them under headings inside the list, which is where a
// small distinction belongs.
//
// No "Rejected" tab either. This screen is the lead list, and the companies the
// pipeline cut are not leads. The rejections are still stored and still drive
// the recheck schedule; the folder header still reports how many were checked.
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "all", label: "All leads", hint: "Everything that fits the profile" },
  { key: "signal", label: "Founder + successor", hint: "Both named and running it today" },
];

// A 'filter'/'hybrid' company that fit the ICP with no signal found is
// still status: 'qualified' in the DB (it passed every gate) — confidence:
// null is what actually distinguishes it from a real qualified/verify
// signal match. See orchestrator.ts's finalHasSignal.
function matchesTab(c: Company, tab: Tab) {
  // "All" means every LEAD, not every row the pipeline touched. It used to
  // return true for everything, so the default view of a folder was mostly
  // rejects and the real count was buried.
  if (tab === "all") return c.status === "qualified";
  // Signal covers confirmed AND needs-a-look. Both are a founder-and-successor
  // claim; only the confidence differs, and the card says which.
  return c.status === "qualified" && c.hasSignal === true;
}

type GroupBy = "signal" | "state" | "contact" | "none";

const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "signal", label: "By signal" },
  { key: "state", label: "By state" },
  { key: "contact", label: "By contact" },
  { key: "none", label: "No grouping" },
];

interface Group {
  key: string;
  label: string;
  blurb: string | null;
  rows: Company[];
  /** Lower sorts first. Keeps the pile he calls at the top. */
  rank: number;
}

/**
 * Split the leads into working piles.
 *
 * The orders are chosen so the first group is always the one to act on:
 * confirmed pairs before fit-only, states with the most leads first, and
 * reachable-now before still-needs-an-email. A group order that put the
 * longest game at the top would make grouping worse than no grouping.
 */
function buildGroups(rows: Company[], by: GroupBy): Group[] {
  if (by === "none") {
    return [{ key: "all", label: "", blurb: null, rows, rank: 0 }];
  }

  const map = new Map<string, Group>();
  const put = (key: string, label: string, blurb: string | null, rank: number, c: Company) => {
    const g = map.get(key) ?? { key, label, blurb, rows: [], rank };
    g.rows.push(c);
    map.set(key, g);
  };

  for (const c of rows) {
    if (by === "signal") {
      const t: SignalType = signalTypeOf(c);
      const meta = SIGNAL_TYPE_META[t];
      const rank = t === "succession_pair" ? 0 : t === "succession_verify" ? 1 : 2;
      put(t, meta.label, meta.blurb, rank, c);
    } else if (by === "state") {
      const code = c.state && c.state !== "-" ? c.state : "Unknown";
      put(code, code, null, 0, c);
    } else {
      // Reachable now, needs a look, or nothing yet — the three states that
      // change what he does next with the row.
      const settled = c.contact?.findStatus === "found" ? c.contact : null;
      if (settled?.verificationStatus === "valid") {
        put("valid", "Email confirmed", "Verified deliverable, ready to send", 0, c);
      } else if (settled?.email) {
        put("found", "Email found", "Deliverability unconfirmed", 1, c);
      } else if (c.contact?.email) {
        put("parked", "Ready to enrich", "A contact is waiting behind the Enrich button", 2, c);
      } else {
        put("none", "No email yet", null, 3, c);
      }
    }
  }

  const groups = [...map.values()];
  // By state, biggest pile first — there is no meaningful order otherwise, and
  // alphabetical would bury the state that actually produced the leads.
  if (by === "state") groups.sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  else groups.sort((a, b) => a.rank - b.rank);
  return groups;
}

export function CompaniesTable({
  companies,
  onRowClick,
  defaultView = "cards",
}: {
  companies: Company[];
  onRowClick: (company: Company) => void;
  /**
   * All Leads opens as a table; a folder opens as cards.
   *
   * Different jobs. A folder is one search you have just run and are reading
   * through — cards, one lead at a time, the quote in full. All Leads is every
   * lead you have ever had, which is a comparing-and-finding job, and rows win
   * for that.
   */
  defaultView?: "cards" | "table";
}) {
  // ALWAYS "All leads". It used to open on the first tab with results, which
  // sounds helpful and meant the opening view changed shape between folders —
  // and on one real run landed on a tab holding ONE company out of sixteen.
  // A list that opens on everything is a list you can trust to be everything.
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState<Industry | "all">("all");
  // Grouping, because a flat list of 80 leads is a list you scroll rather than
  // one you work. "By signal" is the default: it puts the confirmed pairs at
  // the top under their own heading, which is the pile he actually calls, and
  // separates them from the fit-only rows that are a longer game.
  const [groupBy, setGroupBy] = useState<GroupBy>("signal");
  // Cards read one lead well; rows compare many. Neither is "the" view —
  // they answer different questions, so both exist and neither is hidden.
  const [view, setView] = useState<"cards" | "table">(defaultView);

  const counts = useMemo(
    () =>
      TABS.reduce<Record<Tab, number>>((acc, t) => {
        acc[t.key] = companies.filter((c) => matchesTab(c, t.key)).length;
        return acc;
      }, {} as Record<Tab, number>),
    [companies]
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return companies
      .filter((c) => matchesTab(c, tab))
      .filter((c) => (industry === "all" ? true : c.industry === industry))
      .filter((c) =>
        query === ""
          ? true
          : c.name.toLowerCase().includes(query) ||
            (c.founderName ?? "").toLowerCase().includes(query) ||
            (c.nextGenName ?? "").toLowerCase().includes(query) ||
            c.city.toLowerCase().includes(query)
      )
      // Best lead first. Sorting by crawl time put whatever was read last at
      // the top, which is an artefact of the pipeline's ordering rather than
      // anything about the companies — the strongest lead in a folder could
      // sit at the bottom for no reason. Ties break on recency so a fresh
      // find outranks an identical older one.
      .sort((a, b) => {
        const d = scoreFactors(b).score - scoreFactors(a).score;
        return d !== 0 ? d : b.lastCrawledAt.localeCompare(a.lastCrawledAt);
      });
  }, [companies, tab, industry, q]);

  const groups = useMemo(() => buildGroups(filtered, groupBy), [filtered, groupBy]);

  return (
    <div className="rounded-xl border border-gh-border bg-gh-surface">
      <div className="flex flex-wrap items-center gap-1 border-b border-gh-border p-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.key
                ? "bg-gh-navy text-white"
                : "text-gh-ink-secondary hover:bg-gh-surface-sunken"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 tabular ${tab === t.key ? "text-white/60" : "text-gh-ink-muted"}`}>
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-b border-gh-border p-4 sm:flex-row sm:items-center">
        <div className="relative max-w-xs flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gh-ink-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="text"
            placeholder="Filter by company, name, city…"
            className="w-full rounded-lg border border-gh-border bg-gh-surface-sunken py-1.5 pl-8 pr-2.5 text-sm text-gh-ink placeholder:text-gh-ink-muted focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
          />
        </div>
        <div
          role="group"
          aria-label="View style"
          className="flex items-center gap-0.5 rounded-lg bg-gh-surface-sunken p-0.5 sm:ml-auto"
        >
          {([
            { key: "cards", label: "Cards", Icon: RowsIcon },
            { key: "table", label: "Table", Icon: GridIcon },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-200 ${
                view === key
                  ? "bg-gh-surface text-gh-ink shadow-sm"
                  : "text-gh-ink-muted hover:text-gh-ink"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          aria-label="Group leads by"
          className="rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-1.5 text-xs font-medium text-gh-ink-secondary focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
        >
          {GROUP_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value as Industry | "all")}
          className="rounded-lg border border-gh-border bg-gh-surface-sunken px-2.5 py-1.5 text-xs font-medium text-gh-ink-secondary focus:border-gh-sky focus:outline-none focus:ring-2 focus:ring-gh-sky/20"
        >
          <option value="all">All industries</option>
          <option value="landscaping">{INDUSTRY_META.landscaping.label}</option>
          <option value="home_builder">{INDUSTRY_META.home_builder.label}</option>
        </select>
      </div>

      <p className="px-4 pt-3 text-xs text-gh-ink-muted">
        Showing <span className="font-semibold text-gh-ink-secondary">{filtered.length}</span> of{" "}
        {companies.length} leads
      </p>

      {/* Cards, not table rows. The two fields that decide whether he calls —
          the signal quote and the reason it is a lead — are prose, and prose
          does not survive a table column; the old grid answered "what is this
          record" (industry, status, last checked) rather than "why am I
          calling this one". The CSV export keeps the column shape, which is
          where columns are the right answer. */}
      {view === "table" ? (
        // One sheet for everything. Groups become separator rows inside it —
        // rendering a table per group repeated the header down the page and
        // meant no two sections shared a column grid.
        <div className="p-4">
          <LeadTable
            groups={groups.map((g) => ({ key: g.key, label: g.label, rows: g.rows }))}
            showGroupRows={groupBy !== "none"}
            onOpen={onRowClick}
          />
        </div>
      ) : (
        <div className="space-y-5 p-4">
          {groups.map((g) => (
            <section key={g.key}>
              {groupBy !== "none" && (
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gh-ink-secondary">
                    {g.label}
                  </h3>
                  <span className="tabular text-[11px] text-gh-ink-muted">{g.rows.length}</span>
                  {g.blurb && (
                    <span className="hidden text-[11px] text-gh-ink-muted sm:inline">
                      · {g.blurb}
                    </span>
                  )}
                </div>
              )}
              {/* A GRID, not a stack. Full-width cards made every lead a long
                  thin band with a paragraph of empty space to the right of the
                  quote, and three leads filled the screen. Two or three to a
                  row puts a comparable number in view and gives the prose a
                  column width it can actually use.
                  items-stretch so cards in a row match height rather than each
                  one shrinking to its own content, which is what makes a grid
                  of cards read as a grid rather than as debris. */}
              <div className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.rows.map((c, i) => (
                  <div key={c.id} className="h-full" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                    <LeadCard company={c} onOpen={() => onRowClick(c)} />
                  </div>
                ))}
              </div>
            </section>
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-gh-ink-muted">
              No leads match these filters.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
