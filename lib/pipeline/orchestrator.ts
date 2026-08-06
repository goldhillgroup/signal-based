import { createServiceRoleClient } from "../supabase/server";
import { discoverCandidates, fetchCompanyPages, pickBestPage } from "./apify";
import { classifySignal, disprovePass } from "./openrouter";
import { findContact } from "./anymailfinder";
import { verifyEmail } from "./millionverifier";
import type { Industry, SearchMode, SearchRow } from "../supabase/types";

// Contact enrichment (Anymailfinder + MillionVerifier) lives in
// enrichContacts() at the bottom of this file, NOT inline in the discovery
// loop below. Two-step flow (2026-08-06, for testing): discovery +
// classification runs and shows results on its own; enrichment is a
// separate, manually-triggered pass over whatever that run accepted — see
// app/api/search/[id]/enrich/route.ts. It was briefly wired inline for one
// commit; pulled back out per direct instruction to keep the two steps
// testable independently rather than paying for enrichment on every search.

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

// og:site_name is usually the best source (see resolveName below) but a real
// live run surfaced a company saved as literally "Mysite" — a never-
// customized WordPress/theme default that happened to be set as the site
// name. Distrust the handful of common placeholder values rather than
// blindly trusting whatever og:site_name says.
const PLACEHOLDER_SITE_NAMES = new Set([
  "mysite",
  "my site",
  "home",
  "untitled",
  "welcome",
  "wordpress",
  "new site",
  "site title",
]);

function resolveName(
  siteName: string | null,
  classifiedName: string | null,
  domain: string
): string {
  if (siteName && !PLACEHOLDER_SITE_NAMES.has(siteName.trim().toLowerCase())) {
    return siteName;
  }
  return classifiedName ?? cleanDomainName(domain);
}

export async function runSearchPipeline(
  searchId: string,
  industry: Industry,
  states: string[],
  targetSignals: number,
  mode: SearchMode = "signal",
  // Optional free-text focus from the search form. Passed to classification
  // as a non-overriding hint only — see classifySignal in openrouter.ts. It
  // deliberately does NOT touch discovery: letting free text steer which
  // companies get found is exactly how a search drifts off the agreed
  // vertical, which the structured vertical+state inputs exist to prevent.
  refinement?: string | null,
  // Step 01's revenue band, per-search. Both null = no limit. Applied as a
  // SOFT gate: a company only gets cut when the classifier's own size read
  // actively contradicts the chosen band — never on "unknown", since that
  // estimate comes from soft textual proxies (crew size, years in business),
  // not real financials, and cutting on a guess discards real companies.
  band?: { min: number | null; max: number | null }
) {
  const supabase = createServiceRoleClient();

  try {
    const scanCeiling = Math.min(targetSignals * MAX_SCAN_MULTIPLIER, ABSOLUTE_SCAN_CEILING);

    const seenDomains = new Set<string>();
    let totalScanned = 0;
    let qualified = 0; // signal found, confidence high/medium (or fit-only accepted in filter/hybrid, no signal)
    let verify = 0; // signal found, confidence verify
    let fitOnly = 0; // filter/hybrid only: accepted on ICP fit, no signal found
    let accepted = 0; // qualified + verify + fitOnly — the denominator filter/hybrid targets against
    let rejected = 0;

    // What counts toward the target differs by mode:
    //  - 'signal': only companies with a real, confirmed succession signal
    //    (qualified + verify) count — a plain ICP-fit company doesn't move
    //    the needle. Unchanged from the original behavior.
    //  - 'filter' / 'hybrid': ICP fit alone is enough to accept a company, so
    //    the target means "how many companies," full stop — accepted counts
    //    every non-rejected company regardless of whether it happened to
    //    show a signal.
    const countsTowardTarget = () => (mode === "signal" ? qualified + verify : accepted);
    let round = 0;
    let stoppedEarlyReason: string | null = null;

    roundLoop: while (countsTowardTarget() < targetSignals && totalScanned < scanCeiling) {
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
        let channelErrors: string[];
        ({ candidates, exhausted, channelErrors } = await discoverCandidates({
          industry,
          states,
          limit: roundLimit,
          round,
          excludeDomains: seenDomains,
        }));
        // One channel degrading (e.g. Maps times out) isn't fatal — the other
        // channel's results still came through (see apify.ts's
        // Promise.allSettled). Only note it; the round keeps going.
        if (channelErrors.length > 0) {
          console.warn(`Search ${searchId} round ${round}: ${channelErrors.join(" | ")}`);
        }
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
            industry,
            status: "rejected",
            rejection_reason: "No About/Team/Leadership page could be fetched from this domain",
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          continue;
        }

        let classification;
        try {
          classification = await classifySignal(candidate.title, page.url, page.text, refinement);
        } catch (e) {
          await supabase.from("companies").insert({
            ...base,
            name: resolveName(page.siteName, null, candidate.domain),
            industry,
            status: "rejected",
            rejection_reason: `Classification failed: ${(e as Error).message}`.slice(0, 500),
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          continue;
        }

        // Best available source, in trust order: the page's own og:site_name
        // (unless it's a placeholder — see resolveName), then what the
        // classifier read off the page body, then a cleaned-up domain —
        // never the raw Google-search title (see openrouter.ts).
        const companyName = resolveName(page.siteName, classification.companyName, candidate.domain);

        // Stored under the search's own vertical, not the classifier's
        // read — a candidate came from a Maps category search scoped to one
        // vertical already, so this row belongs in that vertical's folder
        // regardless (the classifier's industry read is only used above to
        // catch actual mismatches, e.g. a landscape-*architecture* firm
        // with no install crews turning up in a landscaping search).
        const withName = { ...base, name: companyName, industry };

        if (classification.industry === "other") {
          await supabase.from("companies").insert({
            ...withName,
            status: "rejected",
            rejection_reason: classification.rejectionReason ?? "Outside the landscaping/home-builder ICP",
          });
          rejected++;
          await bump(supabase, searchId, { rejected_count: rejected });
          continue;
        }

        // What the classifier actually found, independent of what this
        // search's mode requires — 'signal' mode gates on it below; 'filter'
        // and 'hybrid' don't, but still capture it (hybrid ranks on it,
        // filter just records it as a bonus fact).
        const hasSignal = classification.qualifies;

        // ICP-fit acceptance: 'signal' mode requires a real signal on top of
        // category fit (unchanged original behavior); 'filter'/'hybrid' only
        // need category fit, already confirmed by the industry !== "other"
        // check above — a plain landscaping company with no succession
        // event is a perfectly good result in those two modes.
        let finalQualifies = mode === "signal" ? hasSignal : true;
        let finalConfidence = classification.confidence;
        let rejectionReason = classification.rejectionReason;
        let disproveNotes: string | null = null;
        // Whether the signal tag survives the disprove pass. Only matters
        // when hasSignal is true to begin with; a filter/hybrid company
        // accepted purely on category fit never had a signal claim to lose.
        let signalStands = hasSignal;

        // Size + current-ownership gates apply in every mode — these are
        // ICP-definition checks (revenue band, still family-run), not
        // signal-authenticity checks, so they cut a filter/hybrid "just
        // category fit" acceptance exactly the same as a signal-mode one.
        // SIZE IS NO LONGER A GATE (2026-08-06, per instruction "start broad,
        // don't limit him"). sizeFit/revenueEstimate are still captured on
        // every row and shown in the UI so the band can be eyeballed or
        // filtered after the fact — but a company is no longer REJECTED for
        // reading too small or too big. Rationale: revenue is being estimated
        // from soft textual proxies (years in business, crew size, service
        // area), not real financials, so cutting on it was throwing away
        // real companies on a guess. Note this deliberately diverges from the
        // delivered proof, which did cut "Too small"/"Too big" — so expect to
        // see companies outside $3-15M in results until Jonathan confirms the
        // band he actually wants. Re-enable by restoring the two branches
        // below (git history: this commit) once that's settled.
        // Soft band check — only fires when a band is actually set AND the
        // classifier's size read directly contradicts it. sizeFit "unknown"
        // (common, and fine) never cuts.
        const bandSet = !!band && (band.min !== null || band.max !== null);
        const belowBand =
          bandSet && band!.min !== null && classification.sizeFit === "too_small";
        const aboveBand =
          bandSet && band!.max !== null && classification.sizeFit === "too_big";

        if (finalQualifies && !classification.stillFamilyOwned) {
          finalQualifies = false;
          rejectionReason =
            "No longer family-owned — acquired/consolidated, current leadership shows no family members.";
        } else if (finalQualifies && belowBand) {
          finalQualifies = false;
          rejectionReason = `Too small — reads below the $${band!.min}M lower bound set for this search.`;
        } else if (finalQualifies && aboveBand) {
          finalQualifies = false;
          rejectionReason = `Too big — reads above the $${band!.max}M upper bound set for this search.`;
        } else if (finalQualifies && hasSignal) {
          // Only worth running the disprove pass when there's an actual
          // signal claim to check — a filter/hybrid company accepted purely
          // on category fit has nothing for it to disprove.
          try {
            const disprove = await disprovePass(companyName, classification, page.text);
            disproveNotes = disprove.notes;
            if (!disprove.holds) {
              signalStands = false;
              if (mode === "signal") {
                // 'signal' mode has nothing left to accept it on — the
                // whole point of the row was the signal, and it just failed.
                finalQualifies = false;
                rejectionReason = disprove.revisedRejectionReason ?? "Did not hold up to the disprove pass";
              }
              // filter/hybrid: the signal claim didn't hold up, but the
              // company still fits the ICP on category/size/ownership alone
              // — keep it as a fit-only result rather than rejecting a
              // perfectly good company over a signal it never needed.
            } else {
              finalConfidence = disprove.revisedConfidence ?? classification.confidence;
            }
          } catch (e) {
            disproveNotes = `Disprove pass failed to run: ${(e as Error).message}`;
            // Couldn't verify the claim either way — don't let an unverified
            // signal ride into 'qualified'/'verify'; fall back to treating
            // it as fit-only in filter/hybrid, and to the original
            // classifier confidence (unchanged) in signal mode as before.
            if (mode !== "signal") signalStands = false;
          }
        }

        const finalHasSignal = hasSignal && signalStands;

        const { data: inserted, error: insertErr } = await supabase
          .from("companies")
          .insert({
            ...withName,
            status: finalQualifies ? "qualified" : "rejected",
            confidence: finalQualifies && finalHasSignal ? finalConfidence : null,
            has_signal: finalQualifies ? finalHasSignal : null,
            discovery_channel: candidate.channel ?? null,
            operating_model: classification.operatingModel ?? null,
            rejection_reason: finalQualifies ? null : rejectionReason,
            revenue_band: classification.revenueEstimate,
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

        if (classification.quote && finalHasSignal) {
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

        if (finalHasSignal) {
          if (finalConfidence === "verify") verify++;
          else qualified++;
        } else {
          fitOnly++;
        }
        accepted = qualified + verify + fitOnly;
        await bump(supabase, searchId, {
          qualified_count: qualified,
          verify_count: verify,
          fit_only_count: fitOnly,
        });

        // Contact enrichment (Anymailfinder + MillionVerifier) is a
        // separate, manually-triggered step now — see enrichContacts()
        // below and app/api/search/[id]/enrich/route.ts. Discovery just
        // stores who to look up (next_gen_name/founder_name, already on
        // this row) and stops here.

        // Target hit mid-round — the rest of this batch was already
        // discovered/fetched (sunk cost), but skip further classify spend.
        if (countsTowardTarget() >= targetSignals) break roundLoop;
      }

      if (exhausted) {
        await bump(supabase, searchId, { candidates_pool_exhausted: true });
        break;
      }
    }

    // A round-level hiccup (caught above) still ends in status: 'complete' —
    // whatever was found and saved is real and shown as-is; the note just
    // explains why the count may fall short of the target. Only an error
    // outside the round loop (e.g. the DB itself) reaches the outer catch
    // and produces a genuine status: 'failed'.
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

// Step 2 of the two-step flow — a manually-triggered pass over whatever a
// completed search accepted (status: 'qualified', any mode/tier: qualified,
// verify, or fit-only). Runs the same findContact/verifyEmail logic that
// used to be inline in the discovery loop above, just decoupled so
// enrichment spend only happens when someone actually clicks the button —
// see app/api/search/[id]/enrich/route.ts.
//
// Safe to re-run: only enriches companies from this search that don't
// already have a contacts row, so a retry after a partial failure (or just
// running it again later) never re-queries someone already looked up.
export async function enrichContacts(searchId: string) {
  const supabase = createServiceRoleClient();

  try {
    const { data: search } = await supabase
      .from("searches")
      .select("contacts_found, contacts_verified")
      .eq("id", searchId)
      .single();
    let contactsFound = search?.contacts_found ?? 0;
    let contactsVerified = search?.contacts_verified ?? 0;

    const { data: companies, error: companiesErr } = await supabase
      .from("companies")
      .select("id, domain, next_gen_name, next_gen_title, founder_name, founder_title")
      .eq("search_id", searchId)
      .eq("status", "qualified");
    if (companiesErr) throw companiesErr;

    const { data: existingContacts } = await supabase
      .from("contacts")
      .select("company_id")
      .in("company_id", (companies ?? []).map((c) => c.id));
    const alreadyEnriched = new Set((existingContacts ?? []).map((c) => c.company_id));

    const toEnrich = (companies ?? []).filter((c) => !alreadyEnriched.has(c.id));

    for (const company of toEnrich) {
      try {
        const targetName = company.next_gen_name ?? company.founder_name ?? null;
        const contact = await findContact(company.domain, targetName);
        if (contact.found && contact.email) {
          const verification = await verifyEmail(contact.email).catch(() => "unknown" as const);
          await supabase.from("contacts").insert({
            company_id: company.id,
            name: contact.name,
            name_inferred: contact.nameInferred,
            title: contact.nameInferred ? null : company.next_gen_title ?? company.founder_title,
            email: contact.email,
            find_status: "found",
            find_source: "anymailfinder",
            verification_status: verification,
            verification_source: "millionverifier",
            verified_at: new Date().toISOString(),
          });
          contactsFound++;
          if (verification === "valid") contactsVerified++;
        } else {
          await supabase.from("contacts").insert({
            company_id: company.id,
            find_status: "not_found",
            find_source: "anymailfinder",
          });
        }
      } catch (e) {
        // One company's vendor hiccup doesn't stop the rest of the batch —
        // it just stays unenriched and picks up on the next run (no
        // contacts row was inserted, so alreadyEnriched won't skip it).
        console.warn(`Search ${searchId}: contact enrichment failed for ${company.domain}: ${(e as Error).message}`);
      }
      await bump(supabase, searchId, { contacts_found: contactsFound, contacts_verified: contactsVerified });
    }

    await bump(supabase, searchId, { enrichment_status: "complete" });
  } catch (e) {
    await bump(supabase, searchId, {
      enrichment_status: "failed",
      enrichment_error: (e as Error).message?.slice(0, 500) ?? "Unknown error",
    });
  }
}
