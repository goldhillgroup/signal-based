"use client";

import { useEffect, useState } from "react";
import type { Company } from "@/lib/company";
import { useSearches } from "@/lib/searches-store";
import { ChevronDownIcon } from "./icons";

/**
 * The rejections, argued rather than hidden.
 *
 * These were pulled out of the product entirely — a folder that read 83 sites
 * and kept 16 was putting 67 companies he had been told not to call in front
 * of him, and mixed into the lead list that was right.
 *
 * But the delivered proof page makes the opposite case, and it is also right:
 * "The rejections are the part that matters most... this is us applying your
 * full test, not matching a keyword and calling it a day." That is the whole
 * answer to three agencies who promised a family-owned filter that does not
 * exist. A list of accepted companies proves nothing; a list of companies
 * REJECTED for the right reasons proves the test ran.
 *
 * Both are true because they are about different places. Not in the working
 * list, where they are noise. Here, at the bottom, behind a disclosure, framed
 * as evidence — the shape the proof page uses.
 *
 * Grouped by reason, because the argument is the DISTRIBUTION: 21 companies
 * cut for having only one generation on the page is the sentence that shows
 * the hard test was applied, and no individual row makes that point.
 */

function groupReason(reason: string | null): string {
  const r = reason ?? "";
  if (/only one generation|no next-gen|only the founder|no founder-and-next-gen|no second[- ]generation/i.test(r))
    return "Only one generation on the leadership page";
  if (/too small|below the/i.test(r)) return "Revenue below your band";
  if (/too big|above the/i.test(r)) return "Revenue above your band";
  if (/no longer family|acquired|consolidat|roll-?up/i.test(r)) return "No longer family-owned";
  if (/marketplace|directory|lead-?gen|publication|not an? (actual|real)/i.test(r))
    return "Not a real trading company";
  if (/outside the|not a landscaping|wrong industry|supplier|hvac|roofing|plumbing/i.test(r))
    return "Wrong trade";
  if (/could not be fetched|404|not found|empty|no content|placeholder/i.test(r))
    return "Site could not be read";
  return "Other";
}

export function WhyTheseAreNot({ searchId, count }: { searchId: string; count: number }) {
  const { fetchRejected } = useSearches();
  const [open, setOpen] = useState(false);
  const [rejected, setRejected] = useState<Company[]>([]);

  // Fetched only when it is opened, and only once. These rows are excluded
  // from every lead view by design, so loading them up front would mean a
  // second query on every folder for a panel most visits never expand.
  useEffect(() => {
    if (!open || rejected.length > 0) return;
    let cancelled = false;
    fetchRejected(searchId).then((r) => {
      if (!cancelled) setRejected(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchId]);

  if (count === 0) return null;

  const groups = new Map<string, Company[]>();
  for (const c of rejected) {
    const k = groupReason(c.rejectionReason);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <section className="rounded-xl border border-gh-border bg-gh-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 sm:p-5"
      >
        <ChevronDownIcon
          className={`mt-0.5 h-4 w-4 shrink-0 text-gh-ink-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-semibold text-gh-ink">
            Why {count} others are not here
          </span>
          <span className="mt-1 block max-w-2xl text-xs leading-relaxed text-gh-ink-secondary">
            Some are real family businesses in the right trade. They were cut
            anyway, because only one generation is on the leadership page, or
            the revenue sits outside your band. This is your full test being
            applied, not a keyword match.
          </span>
        </span>
        <span className="tabular shrink-0 font-display text-lg font-semibold text-gh-ink-muted">
          {count}
        </span>
      </button>

      {/* Always mounted so the height can animate. `inert` keeps the collapsed
          content out of the tab order and the accessibility tree — without it
          a closed panel is invisible but still focusable, which strands
          keyboard users on controls they cannot see. */}
      <div className="gh-collapse" data-open={open ? "true" : "false"} inert={!open}>
        <div>
          <div className="space-y-4 border-t border-gh-border p-4 sm:p-5">
          {rejected.length === 0 && (
            <p className="text-xs text-gh-ink-muted">Loading…</p>
          )}
          {ordered.map(([reason, list]) => (
            <div key={reason}>
              <p className="flex items-baseline gap-2 text-xs font-semibold text-gh-ink">
                {reason}
                <span className="tabular font-normal text-gh-ink-muted">{list.length}</span>
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {list.map((c) => (
                  <li
                    key={c.id}
                    title={c.rejectionReason ?? ""}
                    className="rounded-full border border-gh-border bg-gh-surface-sunken px-2.5 py-1 text-[11px] text-gh-ink-secondary"
                  >
                    {c.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {/* The sharpest evidence in the set: companies whose own NAME says
              multi-generational, cut because only one of them appears on the
              leadership page. A keyword matcher keeps every one of these. */}
          {rejected.some((c) => /generation|dad and daughter|& son/i.test(c.name)) && (
            <p className="border-t border-gh-border pt-3 text-[11px] leading-relaxed text-gh-ink-muted">
              Note the names in there. Companies calling themselves multi-generational
              were still cut when only one family member appears on the leadership
              page — which is exactly the test a keyword search cannot make.
            </p>
          )}
          </div>
        </div>
      </div>
    </section>
  );
}
