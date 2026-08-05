import { createServiceRoleClient } from "../supabase/server";
import { parseIntent } from "./parse-query";
import { discoverCandidates, fetchCompanyPages, pickBestPage } from "./apify";
import { classifySignal, disprovePass } from "./openrouter";
import { findContact } from "./anymailfinder";
import { verifyEmail } from "./millionverifier";
import type { SearchRow } from "../supabase/types";

// Hard cap per search — keeps wall-clock and vendor spend bounded for a v1.
// Revisit once real usage patterns are known (per-search cost is roughly
// $0.01-0.05 in OpenRouter + a few Apify compute units at this size).
const CANDIDATE_LIMIT = 12;

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

export async function runSearchPipeline(searchId: string, query: string) {
  const supabase = createServiceRoleClient();

  try {
    const { states, industry } = parseIntent(query);

    // ── 1. Discover ──────────────────────────────────────────────────────
    const candidates = await discoverCandidates({ industry, states, limit: CANDIDATE_LIMIT });
    await bump(supabase, searchId, {
      candidates_found: candidates.length,
      companies_scanned: candidates.length,
    });

    if (candidates.length === 0) {
      await bump(supabase, searchId, { status: "complete", finished_at: new Date().toISOString() });
      return;
    }

    // ── 2. Fetch pages (one actor run covers every candidate) ───────────
    const pagesByDomain = await fetchCompanyPages(candidates.map((c) => c.domain));
    await bump(supabase, searchId, { pages_fetched: candidates.length });

    let qualified = 0;
    let verify = 0;
    let rejected = 0;
    let contactsFound = 0;
    let contactsVerified = 0;

    // ── 3. Classify -> disprove -> contact -> verify, one candidate at a time
    // (sequential, not parallel — keeps this within sane rate limits for all
    // four vendors and gives the client honest incremental progress to poll).
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

      // ── 4. Contact find + verify (qualified companies only) ───────────
      try {
        const contact = await findContact(candidate.domain, classification.nextGenName);
        if (contact.found && contact.email) {
          contactsFound++;
          const verification = await verifyEmail(contact.email);
          if (verification === "valid") contactsVerified++;
          await supabase.from("contacts").insert({
            company_id: inserted.id,
            name: contact.name,
            name_inferred: contact.nameInferred,
            title: contact.nameInferred ? null : classification.nextGenTitle,
            email: contact.email,
            find_status: "found",
            find_source: "anymailfinder",
            verification_status: verification,
            verification_source: "millionverifier",
            verified_at: new Date().toISOString(),
          });
        } else {
          await supabase.from("contacts").insert({
            company_id: inserted.id,
            find_status: "not_found",
            find_source: "anymailfinder",
            verification_status: "not_attempted",
          });
        }
        await bump(supabase, searchId, {
          contacts_found: contactsFound,
          contacts_verified: contactsVerified,
        });
      } catch {
        await supabase.from("contacts").insert({
          company_id: inserted.id,
          find_status: "not_found",
          find_source: "anymailfinder",
          verification_status: "not_attempted",
        });
      }
    }

    await bump(supabase, searchId, { status: "complete", finished_at: new Date().toISOString() });
  } catch (e) {
    await bump(supabase, searchId, {
      status: "failed",
      error_message: (e as Error).message?.slice(0, 500) ?? "Unknown error",
      finished_at: new Date().toISOString(),
    });
  }
}
