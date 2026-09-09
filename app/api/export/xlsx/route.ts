import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { companiesToXlsx } from "@/lib/xlsx-export";
import { folderTitle } from "@/lib/folder-title";
import { loadMarks } from "@/lib/lead-notes";
import type { Exportable } from "@/lib/csv-export";

/**
 * The lead list as a formatted spreadsheet.
 *
 * ON THE SERVER because ExcelJS is about a megabyte. Importing it into a page
 * would put that in the browser bundle for a button most sessions never press;
 * here it costs the client nothing.
 *
 * The rows are re-read from the database rather than posted up from the
 * browser. A client that sends its own rows is a client that can send anyone
 * else's, and the sheet is the artefact Jonathan forwards.
 *
 * POST { searchId }  one list
 * POST { }           every lead, with the list name as a column
 */

export const maxDuration = 60;

interface Row {
  id: string;
  search_id: string | null;
  domain: string;
  name: string;
  industry: string;
  state: string | null;
  city: string | null;
  revenue_band: string | null;
  employee_band: string | null;
  status: string;
  confidence: string | null;
  rejection_reason: string | null;
  founder_name: string | null;
  founder_title: string | null;
  next_gen_name: string | null;
  next_gen_title: string | null;
  source_url: string | null;
  has_signal: boolean | null;
  discovery_channel: string | null;
  operating_model: string | null;
  first_seen_at: string;
  last_crawled_at: string;
  phone: string | null;
  address: string | null;
  signal_evidence: { quote: string; source_url: string; page_type: string; disprove_notes: string | null }[];
  contacts: {
    name: string | null;
    name_inferred: boolean;
    title: string | null;
    email: string | null;
    find_status: string;
    find_source: string | null;
    verification_status: string;
  }[];
}

/** The same shape lib/searches-store builds, so the exporters see what the app sees. */
function toCompany(
  r: Row,
  listName: string,
  marks?: { note: string | null; grade: number | null }
): Exportable {
  const contacts = (r.contacts ?? []).map((c) => ({
    name: c.name,
    nameInferred: c.name_inferred,
    title: c.title,
    email: c.email,
    findStatus: c.find_status,
    findSource: c.find_source,
    verificationStatus: c.verification_status,
  }));
  const ev = r.signal_evidence?.[0];
  return {
    id: r.id,
    searchId: r.search_id,
    domain: r.domain,
    name: r.name,
    industry: r.industry,
    state: r.state ?? "-",
    city: r.city ?? "-",
    revenueBand: r.revenue_band ?? "Size not stated",
    employeeBand: r.employee_band ?? "not stated",
    status: r.status,
    confidence: r.confidence,
    rejectionReason: r.rejection_reason,
    founderName: r.founder_name,
    founderTitle: r.founder_title,
    nextGenName: r.next_gen_name,
    nextGenTitle: r.next_gen_title,
    sourceUrl: r.source_url,
    hasSignal: r.has_signal,
    discoveryChannel: r.discovery_channel,
    operatingModel: r.operating_model,
    firstSeenAt: r.first_seen_at,
    lastCrawledAt: r.last_crawled_at,
    phone: r.phone,
    address: r.address,
    evidence: ev
      ? {
          quote: ev.quote,
          sourceUrl: ev.source_url,
          pageType: ev.page_type,
          disproveNotes: ev.disprove_notes ?? undefined,
        }
      : null,
    contact: contacts[0] ?? null,
    backupContact: contacts[1] ?? null,
    allContacts: contacts,
    listName,
    ownGrade: marks?.grade ?? null,
    note: marks?.note ?? null,
  } as unknown as Exportable;
}

const SELECT =
  "id, search_id, domain, name, industry, state, city, revenue_band, employee_band, status, " +
  "confidence, rejection_reason, founder_name, founder_title, next_gen_name, next_gen_title, " +
  "source_url, has_signal, discovery_channel, operating_model, first_seen_at, last_crawled_at, " +
  "phone, address, signal_evidence(quote, source_url, page_type, disprove_notes), " +
  "contacts(name, name_inferred, title, email, find_status, find_source, verification_status)";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { searchId?: string };
  const service = createServiceRoleClient();

  const { data: searches } = await service.from("searches").select("id, label");
  const names = new Map((searches ?? []).map((s) => [s.id, folderTitle(s.label)]));

  let q = service.from("companies").select(SELECT).eq("status", "qualified");
  if (body.searchId) q = q.eq("search_id", body.searchId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as Row[];
  const marks = await loadMarks(service);
  // The list column only earns its place on a combined export; a single folder
  // already knows which one it is.
  const companies = rows.map((r) =>
    toCompany(r, body.searchId ? "" : (names.get(r.search_id ?? "") ?? ""), marks[r.id])
  );

  const label = body.searchId ? (names.get(body.searchId) ?? "Leads") : "All leads";
  const buffer = await companiesToXlsx(companies, label);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${label.replace(/[^a-z0-9 -]/gi, "").trim() || "leads"}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
