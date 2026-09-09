"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ENRICH_CEILING_PER_COMPANY_USD } from "@/lib/pipeline/pricing";
import Link from "next/link";
import { useSearches, type SearchFolder } from "@/lib/searches-store";
import { CountUp } from "./CountUp";
import { EnrichProgress } from "./EnrichProgress";
import { UsersIcon, CheckIcon } from "./icons";
import { enrichScopesFor } from "@/lib/enrich-scopes";
import { EnrichScopeDialog } from "./EnrichScopeDialog";

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

export function EnrichmentBoard() {
  const { folders, loading, startEnrichment, refreshFolders, fetchCompanies } = useSearches();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [outstandingBy, setOutstandingBy] = useState<Record<string, number>>({});

  useEffect(() => {
    let off = false;
    fetch("/api/enrichment/outstanding")
      .then((r) => r.json())
      .then((j) => {
        if (!off && j?.byFolder) setOutstandingBy(j.byFolder);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [folders]);

  /**
   * Every list with outstanding leads, in sequence.
   *
   * SEQUENTIAL, not parallel. Each pass already runs six lookups at a time
   * internally; firing eight lists at once would be forty-eight concurrent
   * requests at a vendor that bills per call, which is how an account starts
   * getting rate-limited or looked at.
   */
  async function enrichEveryList() {
    setBusy("__all__");
    setError("");
    let failed = 0;
    for (const f of outstandingFolders) {
      try {
        const res = await fetch(`/api/search/${f.id}/enrich`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "all" }),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
    }
    setBusy(null);
    if (failed > 0) {
      setError(
        `${failed} of ${outstandingFolders.length} lists could not be started. The rest are running.`
      );
    }
    await refreshFolders();
  }
  /** The click waiting on a yes/no. null when no dialog is open. */
  const [pending, setPending] = useState<{
    id: string;
    scopes: ReturnType<typeof enrichScopesFor>;
    label: string;
  } | null>(null);
  /** The run the user just started, so its progress can be shown. */
  const [watching, setWatching] = useState<{ id: string; target: number } | null>(null);

  // Poll while anything is running. The board is otherwise a snapshot taken on
  // mount: enrichment runs on the server for minutes, so without this the
  // counts never move, the row never leaves "Running now", and the only way to
  // learn it finished is to reload the page by hand.
  const anyRunning = folders.some((f) => f.enrichmentStatus === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => {
      refreshFolders();
    }, 3000);
    return () => clearInterval(t);
  }, [anyRunning, refreshFolders]);

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

  // Counted server-side from the rows. See the comment on the route for why
  // the folder counters could not be used: they gave 41 where the truth was
  // 368, on the number this button is priced from.
  // STILL OUTSTANDING, WHICH IS NOT THE SAME AS "READY".
  //
  // bucketOf calls a folder "done" the moment enrichment has run on it once,
  // so a list of 21 leads that came back with 3 addresses sat under Enriched
  // and its other 18 had no way to be picked up again. That is exactly the
  // gap Jon described -- anything still marked needs enrichment should get
  // another pass -- and it is why the whole backlog was invisible.
  //
  // Counted from the folder's own totals rather than by reading every
  // company: an approximation, and it can read low where a counter is ahead
  // of what was actually stored, but it is one query instead of eight.
  const outstandingFolders = folders.filter(
    (f) => f.enrichmentStatus !== "running" && (outstandingBy[f.id] ?? 0) > 0
  );
  const outstanding = outstandingFolders.reduce((n, f) => n + (outstandingBy[f.id] ?? 0), 0);
  const foundSoFar = folders.reduce((n, f) => n + f.contactsFound, 0);
  const verified = folders.reduce((n, f) => n + f.contactsVerified, 0);

  /**
   * Nothing is spent here. This only opens the confirmation.
   *
   * Enrichment bills per address found, on a vendor with a prepaid balance, and
   * the click that starts it used to be immediate and irreversible — one stray
   * tap on "all 83 leads" spends real money with no way to take it back. Every
   * other destructive-or-costly action in the app asks first; this was the one
   * that did not.
   */
  /**
   * Load the folder's companies and offer the same three choices as everywhere
   * else. Scoped by explicit ids rather than the server's scope words, because
   * "only the fits" — the one you want after calling the pairs — has no word:
   * the API knows "signals" and "all", and "all" re-buys the pairs.
   */
  async function askEnrich(id: string, label: string) {
    setError("");
    setBusy(id);
    try {
      setPending({ id, label, scopes: enrichScopesFor(await fetchCompanies(id)) });
    } catch (e) {
      setError((e as Error).message || "Could not read that list.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmEnrich(ids: string[], everyPerson = false) {
    if (!pending) return;
    const { id } = pending;
    setPending(null);
    setBusy(id);
    setError("");
    try {
      await startEnrichment(id, undefined, ids, everyPerson);
      setWatching({ id, target: ids.length });
    } catch (e) {
      setError((e as Error).message || "Could not start enrichment.");
    } finally {
      setBusy(null);
    }
  }

  const watched = watching ? folders.find((f) => f.id === watching.id) : null;

  return (
    <div className="space-y-6">
      {watched && (
        <EnrichProgress
          folder={watched}
          target={watching!.target}
          onDismiss={() => setWatching(null)}
        />
      )}

      {/* Keyed by folder so opening a different list starts fresh. A
          useEffect resetting state on open is the other way to do this and
          it is a synchronous setState inside an effect — lint rejects it,
          and rightly: remounting is the React answer. */}
      <EnrichScopeDialog
        key={pending?.id ?? "none"}
        open={pending !== null}
        folderLabel={pending?.label ?? ""}
        scopes={pending?.scopes ?? []}
        onPick={confirmEnrich}
        onCancel={() => setPending(null)}
      />

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Waiting for emails" value={waiting} accent />
        <Tile label="Emails found" value={foundSoFar} />
        <Tile label="Verified deliverable" value={verified} />
      </div>

      {error && <p className="text-xs font-medium text-gh-critical">{error}</p>}

      {/* ONE PRESS FOR THE WHOLE BACKLOG.
          Jon asked for anything still marked "needs enrichment" to get another
          pass on a schedule. A schedule is a thing this product has promised
          not to do -- the weekly harvest was removed, the handbook says
          "nothing runs on its own", and there is a test asserting no cron
          exists, because he is billed per lookup. This is the same result with
          a person behind it: every list that still has leads without an
          address, in order, one confirmation, one visible cost. */}
      {outstanding > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gh-border bg-gh-surface px-4 py-3">
          <p className="text-xs text-gh-ink-secondary">
            <strong className="font-semibold text-gh-ink">{outstanding}</strong> lead
            {outstanding === 1 ? "" : "s"} across {outstandingFolders.length} list
            {outstandingFolders.length === 1 ? "" : "s"} still have no address, including lists
            that have already been through enrichment once.
          </p>
          <button
            type="button"
            disabled={busy !== null || outstandingFolders.length === 0}
            onClick={() => setConfirmAll(true)}
            className="shrink-0 cursor-pointer rounded-lg bg-gh-navy px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-gh-navy-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40"
          >
            {busy === "__all__" ? "Working through them…" : "Find emails for all of them"}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmAll}
        requirePhrase=""
        title={`Look up ${outstanding} lead${outstanding === 1 ? "" : "s"}?`}
        confirmLabel={`Yes, up to $${(outstanding * ENRICH_CEILING_PER_COMPANY_USD).toFixed(2)}`}
        cancelLabel="Not now"
        onConfirm={() => {
          setConfirmAll(false);
          void enrichEveryList();
        }}
        onCancel={() => setConfirmAll(false)}
        body={
          <>
            <p>
              Every list with leads that have no address, one after another.
            </p>
            <p className="mt-2">
              You are charged per address actually found, so the real figure is
              almost always lower. A lead nobody can find an address for costs
              nothing.
            </p>
          </>
        }
      />

      <Group
        title="Ready to enrich"
        hint="Billed per address found, and nothing runs until you press it. Each list offers up to two choices — just the pairs, where a founder and a successor are both named, or all of its leads. A list with no confirmed pair shows only the second."
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
                <div className="flex shrink-0 items-center gap-1.5">
                  {all > 0 && (
                    <button
                      type="button"
                      onClick={() => askEnrich(f.id, f.label)}
                      disabled={busy === f.id}
                      className="shrink-0 cursor-pointer rounded-lg bg-gh-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-colors duration-200 hover:bg-gh-navy-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gh-sky/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy === f.id ? "Reading…" : "Find personal emails"}
                    </button>
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
        <Group title="Failed" hint="Safe to retry. Enrichment never re-bills a contact it already found.">
          {failed.map((f) => (
            <Row key={f.id} folder={f} note={f.enrichmentError}>
              <button
                type="button"
                onClick={() => askEnrich(f.id, f.label)}
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
        {/* THE NUMBER THAT DECIDES WHETHER TO PRESS THE BUTTON was the one
            missing. "12 leads · 5 emails · 3 verified" tells you what has
            happened and leaves you to subtract for what has not, which is the
            only figure that answers "is there anything left to do here". */}
        <p className="tabular mt-0.5 text-[11px] text-gh-ink-muted">
          {leadCount(folder)} lead{leadCount(folder) === 1 ? "" : "s"}
          {" · "}
          <span className={folder.contactsFound > 0 ? "text-gh-ink-secondary" : ""}>
            {folder.contactsFound} with an address
          </span>
          {" · "}
          <span
            className={
              Math.max(0, leadCount(folder) - folder.contactsFound) > 0
                ? "font-semibold text-gh-ink-secondary"
                : ""
            }
          >
            {Math.max(0, leadCount(folder) - folder.contactsFound)} still to look up
          </span>
          {folder.contactsVerified > 0 ? ` · ${folder.contactsVerified} verified` : ""}
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
