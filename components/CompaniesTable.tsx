"use client";

import { useMemo, useState } from "react";
import { Company } from "@/lib/company";
import { INDUSTRY_META } from "@/lib/signal-meta";
import type { Industry } from "@/lib/supabase/types";
import { scoreFactors, signalTypeOf, SIGNAL_TYPE_META, type SignalType } from "@/lib/lead-signal";
import { SearchIcon, GridIcon, RowsIcon } from "./icons";
import { isWrongKindOfBusiness } from "@/lib/pipeline/recheck-policy";
import { LeadCard } from "./LeadCard";
import { LeadTable } from "./LeadTable";

type Tab = "all" | "signal" | "fit" | "not_a_fit";

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
// A THIRD TAB, for the companies the pipeline cut.
//
// These were removed from the product entirely — a folder that read 67 sites
// and kept 28 was putting 39 companies he had been told not to call in front of
// him, mixed into the list that was right.
//
// They are back as their own tab, which is a different thing from mixing them
// in. The default tab is still the leads, so the first thing on screen is
// always the call list and nothing cut can be dialled by accident. But the cut
// pile is one click away, counted, labelled "Not a fit", and every row carries
// the reason it was cut — because sometimes the reason is wrong, and the only
// way to find that out is to be able to look.
//
// The collapsed evidence panel at the bottom of the folder stays. It answers a
// different question: the DISTRIBUTION of reasons is the argument that a real
// test ran, and no individual row makes that point.
// THREE BUCKETS THAT DO NOT OVERLAP, and that is the change.
//
// It was All leads / Founder + successor / Not a fit, where "All leads" was a
// SUPERSET of the second — so a confirmed pair appeared under two tabs at once
// and neither count told you how many of the other kind there were. Reading
// "All leads 24, Founder + successor 0" left you working out that all 24 were
// the weaker tier, which is exactly the fact the tabs should have stated.
//
// Now each company sits in exactly one, the numbers add up, and the labels are
// the SAME WORDS the cards use (SIGNAL_TYPE_META) rather than a second
// vocabulary three inches away — the mistake that got the previous set
// relabelled. "ICP fit" was the obvious name for the middle one and is jargon
// nobody outside the build would read; the card already calls it what it is.
const TABS: { key: Tab; label: string; hint: string }[] = [
  // LEADS THE SET, AND IS THE DEFAULT.
  //
  // An earlier "All leads" tab was removed because it was a SUPERSET of the
  // next one, so a confirmed pair was counted under two tabs at once and the
  // numbers did not add up. That reasoning was about overlap, and it is fixed
  // by what this tab counts rather than by not having one: every LEAD, which
  // is exactly signal + fit and nothing else. The three below still partition
  // it, so every number on the row still adds up.
  //
  // Why it goes first: opening on "Founder + successor" showed 3 of 12 leads,
  // so a folder looked nearly empty until you noticed the tabs. The first
  // screen should be everything the search got you.
  {
    key: "all",
    label: "All leads",
    hint: "Everything this search got you, pairs and good fits together",
  },
  {
    key: "signal",
    label: "Founder + successor",
    hint: "Both generations named and running it today — the receipt is on the card",
  },
  {
    key: "fit",
    label: "Good fit, no successor named",
    hint: "Right trade, right area, family-run, no successor named on the site",
  },
  { key: "not_a_fit", label: "Not a fit", hint: "Cut by one of your gates, with the reason" },
];

// A 'filter'/'hybrid' company that fit the ICP with no signal found is
// still status: 'qualified' in the DB (it passed every gate) — confidence:
// null is what actually distinguishes it from a real qualified/verify
// signal match. See orchestrator.ts's finalHasSignal.
function matchesTab(c: Company, tab: Tab) {
  // Every lead: the two accepted tiers together, never the cut pile.
  if (tab === "all") return c.status === "qualified";
  // "All" means every LEAD, not every row the pipeline touched. It used to
  // return true for everything, so the default view of a folder was mostly
  // rejects and the real count was buried.
  // The fit tier is qualified WITHOUT a pair — the complement of "signal",
  // not a superset of it.
  if (tab === "fit") return c.status === "qualified" && c.hasSignal !== true;
  // Cut companies, MINUS the ones that were simply a different kind of
  // business. The point of this tab is that a cut might be wrong and worth
  // arguing with — true of "no longer family-owned" or "only one generation
  // named", useless for a funeral home. A live run cut 37 and 24 of them were
  // obituary sites, newspapers, a school reunion page and eight funeral homes;
  // leaving those in buries the handful actually worth a second look. They are
  // counted below, never deleted. See isWrongKindOfBusiness.
  if (tab === "not_a_fit")
    return c.status === "rejected" && !isWrongKindOfBusiness(c.rejectionReason);
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
  onEnrichSelected,
  enrichBusy = false,
}: {
  companies: Company[];
  onRowClick: (company: Company) => void;
  /**
   * Look up addresses for an explicit set of companies.
   *
   * Enrichment used to be a folder-wide switch with two settings, "the signals"
   * or "everything accepted", and neither could reach a company the pipeline
   * cut. Picking rows is what makes a rejected company enrichable at all, and
   * it is also the cheaper habit: the folder-wide button buys an address for
   * every row, this one buys the four you actually want to call.
   *
   * Optional — when it is absent, no checkboxes render at all.
   */
  onEnrichSelected?: (ids: string[]) => void;
  enrichBusy?: boolean;
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
  // OPENS ON THE PAIRS WHEN THERE ARE ANY, otherwise on the fit tier.
  //
  // This reverses an earlier decision and the reason it reverses is worth
  // keeping. The default was "All leads", chosen because opening on the first
  // tab with results made the view change shape between folders — on one run it
  // landed on a tab holding ONE company out of sixteen.
  //
  // That argument depended on there BEING an everything tab. The three buckets
  // are disjoint now, so the choice is no longer "everything vs a subset", it is
  // "which subset" — and landing on an empty list is strictly worse than a view
  // whose shape varies. The old complaint also reads differently in hindsight:
  // one confirmed pair out of sixteen companies IS the find, and opening on it
  // is right rather than unhelpful.
  //
  // Grouping covers what the removed tab did anyway — "By signal" is still the
  // default and puts pairs above the fit rows under their own headings.
  // Opens on everything. Grouping is "By signal" by default, so the pairs are
  // still the first rows on the page, under their own heading -- the reason
  // the old default existed -- without the other nine leads being a click away.
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const selectable = typeof onEnrichSelected === "function";

  const counts = useMemo(
    () =>
      TABS.reduce<Record<Tab, number>>((acc, t) => {
        acc[t.key] = companies.filter((c) => matchesTab(c, t.key)).length;
        return acc;
      }, {} as Record<Tab, number>),
    [companies]
  );

  // Cut companies left out of the "Not a fit" tab because they were a
  // different kind of business rather than a failed gate. Counted so the
  // omission is stated rather than silent — see isWrongKindOfBusiness.
  const offTradeCount = useMemo(
    () =>
      companies.filter(
        (c) => c.status === "rejected" && isWrongKindOfBusiness(c.rejectionReason)
      ).length,
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

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-gh-border bg-gh-surface">
      <div className="flex flex-wrap items-center gap-1 border-b border-gh-border p-2">
        {TABS.filter((t) => t.key !== "not_a_fit" || counts.not_a_fit > 0).map((t) => (
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
            autoComplete="off"
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
          {/* Every vertical in the ICP. Two were listed by hand, so a lead in
              any of the six added later could not be filtered for. */}
          {(Object.keys(INDUSTRY_META) as Industry[]).map((key) => (
            <option key={key} value={key}>
              {INDUSTRY_META[key].label}
            </option>
          ))}
        </select>
      </div>

      {selectable && (
        <SelectionBar
          picked={picked}
          rows={filtered}
          busy={enrichBusy}
          onClear={() => setPicked(new Set())}
          onSelectAll={() => setPicked(new Set(filtered.map((c) => c.id)))}
          onEnrich={() => onEnrichSelected!([...picked])}
        />
      )}

      {/* Denominator scoped to the ACTIVE TAB, not to every row in the folder.
          It read "Showing 28 of 67 leads" — 67 being the leads plus the 39
          rejections — so the one line whose job is "you are seeing all of them"
          said 39 were being hidden by a filter that did not exist. */}
      <p className="px-4 pt-3 text-xs text-gh-ink-muted">
        Showing <span className="font-semibold text-gh-ink-secondary">{filtered.length}</span> of{" "}
        {counts[tab]} {tab === "not_a_fit" ? "cut" : "leads"}
        {/* NEVER a silent filter. The wrong-kind rows are left out because
            arguing with them is pointless, but a list that quietly shrinks is
            worse than a cluttered one — say how many and why. */}
        {tab === "not_a_fit" && offTradeCount > 0 && (
          <>
            {" · "}
            <span>
              {offTradeCount} more {offTradeCount === 1 ? "was" : "were"} a different kind of business
              entirely (funeral homes, newspapers, directories) and {offTradeCount === 1 ? "is" : "are"} not
              shown
            </span>
          </>
        )}
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
            picked={selectable ? picked : null}
            onTogglePick={selectable ? togglePick : undefined}
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
              <div className="stagger grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.rows.map((c) => (
                  <div key={c.id} className="h-full">
                    <LeadCard
                      company={c}
                      onOpen={() => onRowClick(c)}
                      picked={selectable ? picked.has(c.id) : null}
                      onTogglePick={selectable ? () => togglePick(c.id) : undefined}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
          {filtered.length === 0 && (
            // An empty tab has to say WHY, or a zero reads as a failure.
            //
            // "Founder + successor 0" on a folder of 24 leads looks like the
            // product did not work. It usually means the opposite: it read 60
            // companies, found none where both generations were named and
            // present, and refused to pretend otherwise. Hiding the tab when
            // it is empty was the other option and it is worse — the one thing
            // this product exists to find would silently disappear on exactly
            // the runs where its absence is the finding.
            <div className="py-10 text-center">
              {tab === "signal" ? (
                <>
                  <p className="text-sm font-medium text-gh-ink-secondary">
                    No founder-and-successor pair in this batch.
                  </p>
                  <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-gh-ink-muted">
                    Both generations have to be named and currently running the
                    business, in the company&rsquo;s own words. That turns up in
                    roughly one company in forty, so an empty batch is normal
                    rather than a failure — the{" "}
                    {companies.filter((c) => c.status === "qualified").length} leads
                    under &ldquo;All leads&rdquo; are still family-owned companies
                    that fit the profile. Running the same search again carries on
                    from where it stopped.
                  </p>
                </>
              ) : (
                <p className="text-sm text-gh-ink-muted">No leads match these filters.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The picking bar. Appears only once something is picked, because an always-on
 * toolbar for an occasional action is just a strip of dead pixels above every
 * list.
 *
 * It states the number and the fact that it costs money, which is the whole
 * reason the count matters — the confirm dialog still asks before anything is
 * bought, so this is the warning before the warning rather than the last word.
 */
function SelectionBar({
  picked,
  rows,
  busy,
  onClear,
  onSelectAll,
  onEnrich,
}: {
  picked: Set<string>;
  rows: Company[];
  busy: boolean;
  onClear: () => void;
  onSelectAll: () => void;
  onEnrich: () => void;
}) {
  const n = picked.size;
  // Only what is BOTH picked and currently on screen. A pick made on the leads
  // tab stays in the set when the tab changes, and counting it here would
  // offer to enrich rows the user cannot see.
  const visiblePicked = rows.filter((c) => picked.has(c.id)).length;
  const allShown = rows.length > 0 && visiblePicked === rows.length;

  if (n === 0) {
    return (
      <div className="flex items-center gap-3 border-b border-gh-border px-4 py-2">
        <button
          type="button"
          onClick={onSelectAll}
          disabled={rows.length === 0}
          className="cursor-pointer rounded px-1 py-1 text-xs font-semibold text-gh-sky underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
        >
          Select all {rows.length}
        </button>
        <span className="text-xs text-gh-ink-muted">
          or tick the ones you want an email for
        </span>
      </div>
    );
  }

  return (
    <div className="fade-in flex flex-wrap items-center gap-2 border-b border-gh-border bg-gh-sky/[0.07] px-4 py-2.5">
      <span className="text-xs font-semibold text-gh-ink">
        {n} selected
        {visiblePicked !== n && (
          <span className="font-normal text-gh-ink-muted"> ({visiblePicked} on this tab)</span>
        )}
      </span>
      <button
        type="button"
        onClick={allShown ? onClear : onSelectAll}
        className="cursor-pointer rounded px-1 py-1 text-xs font-medium text-gh-sky underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
      >
        {allShown ? "Clear" : `Select all ${rows.length}`}
      </button>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onEnrich}
        disabled={busy}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gh-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gh-navy-2 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
      >
        {busy ? "Starting…" : `Find emails for ${n}`}
      </button>
    </div>
  );
}
