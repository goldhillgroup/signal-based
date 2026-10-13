import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { companiesToXlsx } from "@/lib/xlsx-export";
import { folderTitle } from "@/lib/folder-title";
import { loadMarks } from "@/lib/lead-notes";
import { contactsForCompany, type ContactRow } from "@/lib/company";
import { dedupeCompanies } from "@/lib/dedupe";
import { readAllPages } from "@/lib/supabase/read-all";
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
  // The SAME ranking the app uses (see contactsForCompany). This took the first
  // two rows in whatever order the database returned them, so a name-only
  // co-owner row could come first and the sheet showed a blank email for a
  // company whose list showed one.
  const { contact, backupContact, allContacts } = contactsForCompany(
    (r.contacts ?? []) as unknown as ContactRow[]
  );
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
    contact,
    backupContact,
    allContacts,
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

  // A combined export is the leads that are IN A FOLDER, which is exactly what
  // Lead Lists counts and shows. It used to take every qualified row there was,
  // including the ones reset-leads.mts detaches from their folder to keep as
  // memory ("a company with no folder is invisible while remaining fully
  // known"). The button said "Excel 148" and the file held 488 rows, 340 of them
  // leads from before a reset that appear nowhere in the app.
  const rows = await readAllPages<Row>((from, to) => {
    const q = service.from("companies").select(SELECT).eq("status", "qualified").order("id");
    return (body.searchId ? q.eq("search_id", body.searchId) : q.not("search_id", "is", null)).range(from, to);
  });
  if (!rows) return NextResponse.json({ error: "Could not read the leads." }, { status: 500 });
  const marks = await loadMarks(service);
  // The list column only earns its place on a combined export; a single folder
  // already knows which one it is.
  const companies = rows.map((r) =>
    toCompany(r, body.searchId ? "" : (names.get(r.search_id ?? "") ?? ""), marks[r.id])
  );

  // A combined export holds the same company once per list it was found in.
  // One row each, with the other lists named in a column; a single list has no
  // other lists to fold in.
  const out = body.searchId ? companies : dedupeCompanies(companies).rows;

  const label = body.searchId ? (names.get(body.searchId) ?? "Leads") : "All leads";
  const buffer = await companiesToXlsx(out, label);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${label.replace(/[^a-z0-9 -]/gi, "").trim() || "leads"}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
