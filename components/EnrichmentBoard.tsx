"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearches, type SearchFolder } from "@/lib/searches-store";
import { CountUp } from "./CountUp";
import { UsersIcon, CheckIcon } from "./icons";

/**
 * Contact enrichment as its own job, across every search.
 *
 * It used to be a button inside one folder, which had two problems. It was
 * invisible unless you happened to open the right folder, and it read as part
 * of searching — which it is not. Enrichment bills per PERSON looked up, on a
 * different vendor, and only for companies already accepted. Running it is a
 * spending decision, so it gets a page where the size of that decision is
 * visible before the click.
 */

type Bucket = "ready" | "running" | "done" | "failed";

function bucketOf(f: SearchFolder): Bucket | null {
  if (f.status !== "complete" || leadCount(f) === 0) return null;
  if (f.enrichmentStatus === "running") return "running";
  if (f.enrichmentStatus === "failed") return "failed";
  if (f.enrichmentStatus === "complete") return "done";
  return "ready";
}

function leadCount(f: SearchFolder): number {
  return f.mode === "signal"
    ? f.qualifiedCount + f.verifyCount
    : f.qualifiedCount + f.verifyCount + f.fitOnlyCount;
}

/** Companies where a founder/next-gen pair was actually found. */
function signalCount(f: SearchFolder): number {
  return f.qualifiedCount + f.verifyCount;
}

/** ~$0.05 per address at AnymailFinder's rate; they bill only on a find. */
const PER_EMAIL_USD = 0.05;

export function EnrichmentBoard() {
  const { folders, loading, startEnrichment } = useSearches();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (loading) return null;

  const withBucket = folders
    .map((f) => ({ f, b: bucketOf(f) }))
    .filter((x): x is { f: SearchFolder; b: Bucket } => x.b !== null);

  const ready = withBucket.filter((x) => x.b === "ready").map((x) => x.f);
  const running = withBucket.filter((x) => x.b === "running").map((x) => x.f);
  const done = withBucket.filter((x) => x.b === "done").map((x) => x.f);
  const failed = withBucket.filter((x) => x.b === "failed").map((x) => x.f);

  // The number that makes the decision: people who could be looked up but
  // have not been. Everything else on this page is detail.
  const waiting = ready.reduce((n, f) => n + leadCount(f), 0);
  const foundSoFar = folders.reduce((n, f) => n + f.contactsFound, 0);
  const verified = folders.reduce((n, f) => n + f.contactsVerified, 0);

  async function enrich(id: string, scope: "signals" | "all") {
    setBusy(id);
    setError("");
    try {
      await startEnrichment(id, scope);
    } catch (e) {
      setError((e as Error).message || "Could not start enrichment.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Waiting for emails" value={waiting} accent />
        <Tile label="Emails found" value={foundSoFar} />
        <Tile label="Verified deliverable" value={verified} />
      </div>

      {error && <p className="text-xs font-medium text-gh-critical">{error}</p>}

      <Group
        title="Ready to enrich"
        hint="Billed per address found — pick how wide to go. Nothing runs until you press it."
      >
        {ready.length === 0 ? (
          <Empty>Nothing waiting. Every finished search has been through enrichment.</Empty>
        ) : (
          ready.map((f) => {
            const sig = signalCount(f);
            const all = leadCount(f);
            return (
              <Row key={f.id} folder={f}>
                {/* Two buttons rather than one, because the difference is a
                    spending decision and it is often large — the signals are a
                    small subset of everything that fits the ICP. Both show the
                    count AND the money, so the choice is made with the numbers
                    visible instead of after the invoice. */}
                <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                  {sig > 0 && (
                    <ScopeButton
                      busy={busy === f.id}
                      onClick={() => enrich(f.id, "signals")}
                      label={`${sig} signal${sig === 1 ? "" : "s"}`}
                      cost={sig * PER_EMAIL_USD}
                      primary
                    />
                  )}
                  {all > sig && (
                    <ScopeButton
                      busy={busy === f.id}
                      onClick={() => enrich(f.id, "all")}
                      label={`all ${all} leads`}
                      cost={all * PER_EMAIL_USD}
                    />
                  )}
                  {sig === 0 && all === 0 && (
                    <span className="text-[11px] text-gh-ink-muted">nothing to enrich</span>
                  )}
                </div>
              </Row>
            );
          })
        )}
      </Group>

      {running.length > 0 && (
        <Group title="Running now">
          {running.map((f) => (
            <Row key={f.id} folder={f}>
              <span className="shrink-0 rounded-full bg-gh-sky/10 px-2.5 py-1 text-[11px] font-semibold text-gh-sky">
                running
              </span>
            </Row>
          ))}
        </Group>
      )}

      {failed.length > 0 && (
        <Group title="Failed" hint="Safe to retry — enrichment never re-bills a contact it already found.">
          {failed.map((f) => (
            <Row key={f.id} folder={f} note={f.enrichmentError}>
              <button
                type="button"
                onClick={() => enrich(f.id, "signals")}
                disabled={busy === f.id}
                className="shrink-0 cursor-pointer rounded-lg border border-gh-border bg-gh-surface px-3 py-1.5 text-[11px] font-semibold text-gh-ink transition-colors duration-200 hover:bg-gh-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:opacity-40"
              >
                {busy === f.id ? "Retrying…" : "Retry"}
              </button>
            </Row>
          ))}
        </Group>
      )}

      {done.length > 0 && (
        <Group title="Done">
          {done.map((f) => (
            <Row key={f.id} folder={f}>
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-gh-surface-sunken px-2.5 py-1 text-[11px] font-semibold text-gh-ink-secondary">
                <CheckIcon className="h-3 w-3" />
                {f.contactsFound} found
              </span>
            </Row>
          ))}
        </Group>
      )}
    </div>
  );
}

/**
 * One enrichment scope. Shows the count and the money together — the whole
 * point of splitting the button is that the two options differ in price, so
 * hiding the price would defeat it.
 */
function ScopeButton({
  busy,
  onClick,
  label,
  cost,
  primary,
}: {
  busy: boolean;
  onClick: () => void;
  label: string;
  cost: number;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? "bg-gh-navy text-white hover:bg-gh-navy-2"
          : "border border-gh-border bg-gh-surface text-gh-ink-secondary hover:border-gh-sky/40 hover:text-gh-ink"
      }`}
    >
      {busy ? "Starting…" : label}
      <span className={`tabular ml-1.5 font-normal ${primary ? "text-white/60" : "text-gh-ink-muted"}`}>
        ~${cost.toFixed(2)}
      </span>
    </button>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-gh-border bg-gh-surface p-4">
      <p className="font-display text-2xl font-semibold text-gh-ink">
        <CountUp value={value} />
      </p>
      <p className="mt-0.5 text-[11px] font-medium text-gh-ink-secondary">{label}</p>
      {accent && <span className="mt-2 block h-1 w-8 rounded-full bg-gh-orange" />}
    </div>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="font-display text-sm font-semibold text-gh-ink">{title}</h2>
        {hint && <p className="text-[11px] text-gh-ink-muted">{hint}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  folder,
  note,
  children,
}: {
  folder: SearchFolder;
  note?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gh-border bg-gh-surface px-4 py-3">
      <div className="min-w-0">
        <Link
          href={`/dashboard/lists/${folder.id}`}
          className="block truncate text-xs font-semibold text-gh-ink underline-offset-2 hover:underline"
        >
          {folder.label}
        </Link>
        <p className="tabular mt-0.5 text-[11px] text-gh-ink-muted">
          {leadCount(folder)} leads · {folder.contactsFound} emails · {folder.contactsVerified} verified
        </p>
        {note && <p className="mt-1 text-[11px] text-gh-critical">{note}</p>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-dashed border-gh-border bg-gh-surface px-4 py-6 text-xs text-gh-ink-muted">
      <UsersIcon className="h-4 w-4 shrink-0" />
      {children}
    </p>
  );
}
