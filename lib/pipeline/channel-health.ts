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

export interface ChannelWarning {
  channel: string;
  reason: string;
  actionable: boolean;
}

/**
 * Turn a raw thrown message ("Web search channel failed: Apify self-imposed
 * budget cap hit: this account has used $5.64 this cycle (cap: $5)") into
 * something worth putting in front of a user.
 */
export function summarizeChannelError(raw: string): ChannelWarning {
  // [\s\S] rather than the /s flag — the tsconfig target predates ES2018.
  const m = raw.match(/^(.*?) channel failed: ([\s\S]*)$/);
  const rawChannel = m ? m[1].trim() : "A discovery channel";
  const detail = m ? m[2] : raw;

  const hit = REASONS.find((r) => r.test.test(detail));
  return {
    channel: CHANNEL_LABELS[rawChannel] ?? rawChannel,
    reason: hit ? hit.short : "failed",
    // Unknown failures are treated as actionable: better to send someone
    // looking at a healthy vendor than to bury a real outage as "transient".
    actionable: hit ? hit.actionable : true,
  };
}

/**
 * Collapse every degraded channel seen across all rounds into one line.
 *
 * Deliberately states what DID run as well as what didn't — "3 of 4 channels"
 * is the number that tells him how much to trust a short result. Returns null
 * when nothing degraded, so callers can render nothing at all.
 */
export function buildWarningLine(
  rawErrors: Iterable<string>,
  // 4 since licensing joined discoverCandidates. This default is the only
  // place the channel count is written down, so adding a fifth channel means
  // changing it here as well as in apify.ts.
  totalChannels = 4
): string | null {
  const byChannel = new Map<string, ChannelWarning>();
  for (const raw of rawErrors) {
    const w = summarizeChannelError(raw);
    // First reason per channel wins — a channel that was capped in round 1 and
    // timed out in round 4 is still "capped" as far as the user is concerned.
    if (!byChannel.has(w.channel)) byChannel.set(w.channel, w);
  }
  if (byChannel.size === 0) return null;

  const parts = Array.from(byChannel.values()).map((w) => `${w.channel} ${w.reason}`);
  const used = Math.max(0, totalChannels - byChannel.size);
  const anyActionable = Array.from(byChannel.values()).some((w) => w.actionable);

  return (
    `Searched with ${used} of ${totalChannels} discovery channels — ${parts.join("; ")}. ` +
    (used === 0
      ? "No channel was able to search, so this is not a statement about what exists."
      : "Results may be incomplete" +
        (anyActionable ? " until that's topped up." : " — worth re-running later."))
  );
}
