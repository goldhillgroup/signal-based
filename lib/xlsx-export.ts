import ExcelJS from "exceljs";
import { usedColumns, type Exportable } from "./csv-export";

/**
 * The lead list as a formatted spreadsheet.
 *
 * WHY THIS EXISTS ALONGSIDE THE CSV. A CSV has no styling by definition, so a
 * sheet Jonathan opens is grey rows he then formats himself, every time. He
 * asked for it to arrive looking like something.
 *
 * SERVER-SIDE ON PURPOSE. ExcelJS is about a megabyte; importing it into a
 * page would put that in the browser bundle for a button most sessions never
 * press. Built in a route instead, it costs the client nothing.
 *
 * The CSV stays. It is the format that opens anywhere, and an .xlsx is one
 * more thing to go wrong when somebody just wants the rows.
 */

const INK = "FF0B1220";
const LEAD_GREEN = "FF0B7A0B";
const CUT_RED = "FFA3272A";

export async function companiesToXlsx(
  companies: Exportable[],
  sheetName = "Leads"
): Promise<Buffer> {
  const cols = usedColumns(companies);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Signal Radar";
  wb.created = new Date();

  // A sheet name cannot carry : \ / ? * [ ] and Excel refuses the file rather
  // than fixing it, so a folder called "3 verticals · CT/MA/NJ" would produce
  // a workbook that will not open.
  const ws = wb.addWorksheet(sheetName.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Leads");

  ws.columns = cols.map((c) => ({
    header: c.header.replace(/_/g, " "),
    key: c.header,
    width:
      c.header === "remarks"
        ? 34
        : c.header === "signal_detail" || c.header === "why_this_lead"
          ? 52
          : c.header === "company" || c.header === "list"
            ? 30
            : c.header.includes("email") || c.header === "source_url"
              ? 32
              : 16,
  }));

  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" }, name: "Arial" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF26324A" } } };
  });

  for (const c of companies) {
    const row = ws.addRow(Object.fromEntries(cols.map((col) => [col.header, col.get(c)])));
    row.alignment = { vertical: "top", wrapText: true };
    row.font = { size: 10, name: "Arial" };

    // ExcelJS reads an unknown string key as a column INDEX, and a name it
    // cannot resolve comes out as NaN -- "Out of bounds. Excel supports
    // columns from 1 to 16384", which is what a missing key produced here.
    // Every getCell below is guarded by what the sheet actually has.
    const have = new Set(cols.map((c) => c.header));
    const cell = (key: string) => (have.has(key) ? row.getCell(key) : null);

    const verdict = String(cell("verdict")?.value ?? "");
    const cut = verdict === "NOT A FIT";
    const vc = cell("verdict");
    if (vc) {
      vc.font = { bold: true, size: 10, name: "Arial", color: { argb: cut ? CUT_RED : LEAD_GREEN } };
    }
    // A cut row is tinted rather than coloured throughout: it is still a row
    // worth reading, and red text on every cell reads as an error.
    if (cut) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF3F3" } };
      });
    }
    // Somewhere to write, and obviously so.
    const rem = cell("remarks");
    if (rem) {
      rem.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFDF3" } };
      rem.border = { left: { style: "thin", color: { argb: "FFE8D9A8" } } };
    }
    for (const key of cols.map((c) => c.header)) {
      const target = cell(key);
      const v = String(target?.value ?? "");
      if (!target || !v) continue;
      const isUrl = /^https?:\/\//.test(v);
      const isEmail = v.includes("@") && !v.includes(" ") && !isUrl;
      if (!isUrl && !isEmail) continue;
      target.value = { text: v, hyperlink: isUrl ? v : `mailto:${v}` };
      target.font = { size: 10, name: "Arial", color: { argb: "FF0B5E85" }, underline: true };
    }
  }

  // The header stays put while scrolling, and every column gets a filter --
  // the two things anybody does to a lead list before reading it.
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  // ExcelJS returns its own Buffer type; Buffer.from gives the Node one a
  // route can stream without a cast that lies about the shape.
  return Buffer.from(await wb.xlsx.writeBuffer());
}
