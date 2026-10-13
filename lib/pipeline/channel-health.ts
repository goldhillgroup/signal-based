/**
 * "This one is out of ammo, so it wasn't used."
 *
 * Discovery runs four channels under Promise.allSettled and page fetching
 * falls back free -> Firecrawl -> Apify, so a single vendor dying never stops
 * a run. That resilience created a subtler problem: a run where Maps was
 * budget-capped looks IDENTICAL to one where all four channels searched and
 * the state is simply mined out. The user reads "23 companies found" and
 * reasonably concludes that's what exists — when really one of three channels
 * never looked.
 *
 * Same failure class as silently dropping a state from "Texas + Oklahoma":
 * a confidently-presented partial answer. So every degraded channel gets
 * recorded and shown, even when the run otherwise succeeds.
 */

/** Channels the user should recognize by name, not by internal identifier. */
const CHANNEL_LABELS: Record<string, string> = {
  Directory: "Directories",
  Licensing: "State licensing boards",
  "Web search": "Web search",
  Maps: "Google Maps",
};

interface Reason {
  test: RegExp;
  /** Short, non-technical: what he needs to know to act. */
  short: string;
  /** Whether topping something up would fix it. */
  actionable: boolean;
}

const REASONS: Reason[] = [
  {
    test: /self-imposed budget cap|budget cap hit|cap: \$/i,
    short: "hit its spending cap",
    actionable: true,
  },
  {
    test: /insufficient credit|402|payment required|out of credit|quota|exceeded/i,
    short: "out of credits",
    actionable: true,
  },
  {
    test: /401|403|unauthor|invalid.*(key|token)|missing.*(key|token)|not configured/i,
    short: "key missing or rejected",
    actionable: true,
  },
  {
    test: /429|rate limit|too many requests/i,
    short: "rate-limited",
    actionable: false,
  },
  {
    test: /timeout|timed out|ETIMEDOUT|abort/i,
    short: "timed out",
    actionable: false,
  },
  {
    test: /5\d\d|ECONNRESET|ENOTFOUND|network|fetch failed/i,
    short: "unreachable",
    actionable: false,
  },
];

interface ChannelWarning {
  channel: string;
  reason: string;
  actionable: boolean;
  /** Failed for every state in that call, rather than for some of them. */
  total: boolean;
  /** For a partial failure, the states that could not be searched. */
  states: string | null;
}

/**
 * The channels that actually PRODUCE leads, by measurement.
 *
 * On this installation's own reads, web search finds a confirmed pair about one
 * time in ten to thirty reads and Maps is the volume backstop behind it;
 * the directory channel produced zero pairs in 159 reads and licensing boards
 * about none. A warning that says "results may be incomplete" is a claim about
 * the RESULTS, so it is only true when a channel that moves the results was
 * degraded. Putting the same banner on a run because a free government download
 * returned a 504 is what taught people to ignore it.
 *
 * Minor channels are still counted (they appear in the used/total sum) but they
 * never raise the banner on their own.
 */
const MATERIAL_CHANNELS = new Set(["Web search", "Google Maps"]);

/**
 * Turn a raw message into something worth putting in front of a user.
 *
 * Two shapes arrive from discoverCandidates:
 *   "Web search channel failed: Apify self-imposed budget cap hit: ..."  (every state failed)
 *   "Web search channel failed for CA/NY only"                           (some states failed)
 * The second has no colon, so the original single pattern never matched it and
 * the channel name came out as "A discovery channel" -- which is exactly the
 * unreadable "A discovery channel failed" that was showing on real runs.
 */
function summarizeChannelError(raw: string): ChannelWarning {
  // [\s\S] rather than the /s flag — the tsconfig target predates ES2018.
  const full = raw.match(/^(.*?) channel failed: ([\s\S]*)$/);
  const partial = !full ? raw.match(/^(.*?) channel failed for (.+?) only$/) : null;
  const rawChannel = (full?.[1] ?? partial?.[1] ?? "").trim();
  const detail = full ? full[2] : raw;

  const hit = REASONS.find((r) => r.test.test(detail));
  return {
    channel: CHANNEL_LABELS[rawChannel] ?? (rawChannel || "A discovery channel"),
    reason: hit ? hit.short : "failed",
    // Unknown failures are treated as actionable: better to send someone
    // looking at a healthy vendor than to bury a real outage as "transient".
    actionable: hit ? hit.actionable : true,
    total: !partial,
    states: partial ? partial[2].trim() : null,
  };
}

export interface WarningOptions {
  /**
   * How many discovery calls this pass made. With it, a channel is only called
   * degraded when it failed in at least HALF of them: one Maps timeout in a
   * four-call run searched a pool that was still almost entirely there. Without
   * it, every failure counts, as before.
   */
  calls?: number;
}

/**
 * Collapse every degraded channel seen across all rounds into one line.
 *
 * Deliberately states what DID run as well as what didn't — "3 of 4 channels"
 * is the number that tells him how much to trust a short result. Returns null
 * when nothing that matters degraded, so callers can render nothing at all.
 */
export function buildWarningLine(
  rawErrors: Iterable<string>,
  // 4 since licensing joined discoverCandidates. This default is the only
  // place the channel count is written down, so adding a fifth channel means
  // changing it here as well as in apify.ts.
  totalChannels = 4,
  opts: WarningOptions = {}
): string | null {
  // Every occurrence is kept (a Set of strings used to collapse repeats), so a
  // channel that failed in all four rounds is distinguishable from one that
  // failed once.
  const byChannel = new Map<string, { w: ChannelWarning; hits: number; states: Set<string> }>();
  for (const raw of rawErrors) {
    const w = summarizeChannelError(raw);
    const entry = byChannel.get(w.channel) ?? { w, hits: 0, states: new Set<string>() };
    entry.hits++;
    if (w.states) w.states.split("/").forEach((st) => entry.states.add(st.trim()));
    // First reason per channel wins — a channel that was capped in round 1 and
    // timed out in round 4 is still "capped" as far as the user is concerned.
    byChannel.set(w.channel, entry);
  }
  if (byChannel.size === 0) return null;

  const calls = opts.calls;
  const degraded = Array.from(byChannel.values()).filter(({ hits }) =>
    calls === undefined ? true : hits >= Math.max(1, Math.ceil(calls / 2))
  );
  if (degraded.length === 0) return null;

  // Searched with N of M: how many channels worked, counting the minor ones.
  const used = Math.max(0, totalChannels - degraded.length);
  const material = degraded.filter(({ w }) => MATERIAL_CHANNELS.has(w.channel));
  const nothingSearched = used === 0;

  // Only minor channels degraded, and something else worked: not a statement
  // about the results, so say nothing.
  if (material.length === 0 && !nothingSearched) return null;

  const shown = nothingSearched ? degraded : material;
  const parts = shown.map(({ w, states }) =>
    w.total || states.size === 0
      ? `${w.channel} ${w.reason}`
      : `${w.channel} could not search ${Array.from(states).join(", ")}`
  );
  const anyActionable = shown.some(({ w }) => w.actionable);

  return (
    `Searched with ${used} of ${totalChannels} discovery channels, ${parts.join("; ")}. ` +
    (nothingSearched
      ? "No channel was able to search, so this is not a statement about what exists."
      : "Results may be incomplete" +
        (anyActionable ? " until that's topped up." : ", worth re-running later."))
  );
}
