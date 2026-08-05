import { createServiceRoleClient } from "../supabase/server";
import { parseIntent } from "./parse-query";
import { discoverCandidates, fetchCompanyPages, pickBestPage } from "./apify";
import { classifySignal, disprovePass } from "./openrouter";
import type { SearchRow } from "../supabase/types";

// Contact enrichment (Anymailfinder + MillionVerifier) is built and tested
// (lib/pipeline/anymailfinder.ts, millionverifier.ts) but deliberately NOT
// called here — per instruction 2026-08-05: prove the signal logic first on
// a real target count, hold off on enrichment spend until that's dialed in.
// Re-enable by importing findContact/verifyEmail and adding the block back
// where QUALIFIED signals are inserted below.

// The target is a SIGNAL count, not a raw candidate count: "give me 100
// signals" means keep discovering + classifying in rounds, accumulating
// qualified+verify companies, until ~100 are found — not "scan 100 companies
// and stop." Confirmed signals from an early round are never discarded; a
// short round just triggers another round rather than being treated as done.
const ROUND_SIZE = 15;
const MAX_SCAN_MULTIPLIER = 6; // never scan more than target * this
const ABSOLUTE_SCAN_CEILING = 240; // hard stop regardless of target — cost/time sanity

type Supa = ReturnType<typeof createServiceRoleClient>;

async function bump(supabase: Supa, searchId: string, patch: Partial<SearchRow>) {
  await supabase.from("searches").update(patch).eq("id", searchId);
}

// Last-resort name when neither og:site_name nor the classifier could read
// one off the page (e.g. the fetch failed entirely) — never used when a real
// source name is available.
function cleanDomainName(domain: string): string {
  const label = domain.split(".")[0].replace(/[-_]+/g, " ").trim();
  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function runSearchPipeline(searchId: string, query: string, targetSignals: number) {
  const supabase = createServiceRoleClient();

  try {
    const { states, industry } = parseIntent(query);
    const scanCeiling = Math.min(targetSignals * MAX_SCAN_MULTIPLIER, ABSOLUTE_SCAN_CEILING);

    const seenDomains = new Set<string>();
    let totalScanned = 0;
    let qualified = 0;
    let verify = 0;
    let rejected = 0;
    let round = 0;
    let stoppedEarlyReason: string | null = null;

    roundLoop: while (qualified + verify < targetSignals && totalScanned < scanCeiling) {
      round++;
      const roundLimit = Math.min(ROUND_SIZE, scanCeiling - totalScanned);

      // Discover + fetch get their own try/catch: an Apify hiccup (timeout,
      // rate limit) on round 2+ must not discard signals already found and
      // persisted in earlier rounds — degrade to "stop here, keep what we
      // have" rather than letting it bubble to the outer catch's full
      // status: 'failed', which would misrepresent real, saved results as
      // a failed run.
      let candidates, exhausted;
      try {
        // ── 1. Discover this round's batch (excludes every domain seen so far) ──
        ({ candidates, exhausted } = await discoverCandidates({
          industry,
          states,
          limit: roundLimit,
          round,
          excludeDomains: seenDomains,
        }));
      } catch (e) {
        stoppedEarlyReason = `Stopped after round ${round}: discovery failed (${(e as Error).message.slice(0, 200)})`;
        break;
      }

      if (candidates.length === 0) {
        await bump(supabase, searchId, { candidates_pool_exhausted: true });
        break;
      }

      candidates.forEach((c) => seenDomains.add(c.domain));
      totalScanned += candidates.length;
      await bump(supabase, searchId, {
        candidates_found: totalScanned,
        companies_scanned: totalScanned,
      });

      // ── 2. Fetch pages for this round's batch ────────────────────────────
      let pagesByDomain;
      try {
        pagesByDomain = await fetchCompanyPages(candidates.map((c) => c.domain));
      } catch (e) {
        stoppedEarlyReason = `Stopped after round ${round}: page fetch failed (${(e as Error).message.slice(0, 200)})`;
        break;
      }
      await bump(supabase, searchId, { pages_fetched: totalScanned });

      // ── 3. Classify -> disprove, one candidate at a time ─────────────────
      for (const candidate of candidates) {
        const page = pickBestPage(pagesByDomain.get(candidate.domain) ?? []);

        const base = {
          search_id: searchId,
          domain: candidate.domain,
          state: states[0] ?? null,
          source_url: page?.url ?? candidate.url,
          first_seen_at: new Date().toISOString(),
          last_crawled_at: new Date().toISOString(),
        };

        if (!page) {
          await supabase.from("companies").insert({
            ...base,
            name: cleanDomainName(candidate.domain),
            industry: industry ?? "landscaping",
            status: "rejected",
            rejection_reason: "No About/Team/Leadership page could be fetched from this domain",
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          continue;
        }

        let classification;
        try {
          classification = await classifySignal(candidate.title, page.url, page.text);
        } catch (e) {
          await supabase.from("companies").insert({
            ...base,
            name: page.siteName ?? cleanDomainName(candidate.domain),
            industry: industry ?? "landscaping",
            status: "rejected",
            rejection_reason: `Classification failed: ${(e as Error).message}`.slice(0, 500),
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          continue;
        }

        // Best available source, in trust order: the page's own og:site_name,
        // then what the classifier read off the page body, then a cleaned-up
        // domain — never the raw Google-search title (see openrouter.ts).
        const companyName =
          page.siteName ?? classification.companyName ?? cleanDomainName(candidate.domain);

        if (classification.industry === "other") {
          await supabase.from("companies").insert({
            ...base,
            name: companyName,
            industry: industry ?? "landscaping",
            status: "rejected",
            rejection_reason: classification.rejectionReason ?? "Outside the landscaping/home-builder ICP",
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          continue;
        }

        let finalQualifies = classification.qualifies;
        let finalConfidence = classification.confidence;
        let rejectionReason = classification.rejectionReason;
        let disproveNotes: string | null = null;

        if (classification.qualifies) {
          try {
            const disprove = await disprovePass(companyName, classification, page.text);
            disproveNotes = disprove.notes;
            if (!disprove.holds) {
              finalQualifies = false;
              rejectionReason = disprove.revisedRejectionReason ?? "Did not hold up to the disprove pass";
            } else {
              finalConfidence = disprove.revisedConfidence ?? classification.confidence;
            }
          } catch (e) {
            disproveNotes = `Disprove pass failed to run: ${(e as Error).message}`;
          }
        }

        const { data: inserted, error: insertErr } = await supabase
          .from("companies")
          .insert({
            ...base,
            name: companyName,
            industry: classification.industry,
            status: finalQualifies ? "qualified" : "rejected",
            confidence: finalQualifies ? finalConfidence : null,
            rejection_reason: finalQualifies ? null : rejectionReason,
            founder_name: classification.founderName,
            founder_title: classification.founderTitle,
            next_gen_name: classification.nextGenName,
            next_gen_title: classification.nextGenTitle,
          })
          .select("id")
          .single();

        if (insertErr || !inserted) {
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          continue;
        }

        if (classification.quote) {
          await supabase.from("signal_evidence").insert({
            company_id: inserted.id,
            quote: classification.quote,
            source_url: page.url,
            page_type: classification.pageType,
            disprove_notes: disproveNotes,
          });
        }

        if (!finalQualifies) {
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          continue;
        }

        if (finalConfidence === "verify") verify++;
        else qualified++;
        await bump(supabase, searchId, { qualified_count: qualified, verify_count: verify });

        // Target hit mid-round — the rest of this batch was already
        // discovered/fetched (sunk cost), but skip further classify spend.
        if (qualified + verify >= targetSignals) break roundLoop;
      }

      if (exhausted) {
        await bump(supabase, searchId, { candidates_pool_exhausted: true });
        break;
      }
    }

    // A round-level hiccup (caught above) still ends in status: 'complete' —
    // whatever was found and saved is real and shown as-is; the note just
    // explains why the count may fall short of the target. Only an error
    // outside the round loop (e.g. parseIntent, the DB itself) reaches the
    // outer catch and produces a genuine status: 'failed'.
    await bump(supabase, searchId, {
      status: "complete",
      error_message: stoppedEarlyReason,
      finished_at: new Date().toISOString(),
    });
  } catch (e) {
    await bump(supabase, searchId, {
      status: "failed",
      error_message: (e as Error).message?.slice(0, 500) ?? "Unknown error",
      finished_at: new Date().toISOString(),
    });
  }
}
