/**
 * Report sheets as a PDF and as an Excel workbook — the auditor pack.
 *
 * The PDF reuses the daily report's embedded Noto faces (so ₹ and Sanskrit names survive) and its
 * letterhead crest. It is imported on demand, like the daily report's: neither jsPDF nor the
 * fonts weigh on first paint. Pages are landscape A4 because a trial balance has seven columns.
 */
import * as XLSX from "xlsx";
import type jsPDF from "jspdf";
import { brand } from "./brand";
import { blankDoc, C, crest, loadLogo, stampNow } from "./pdf";
import type { Cell, Sheet } from "./sheets";

const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (c: Cell) => (c == null ? "" : typeof c === "number" ? fmt(c) : c);

// ----------------------------------------------------------------------------- Excel
const SHEET_NAME_BAD = /[\\/?*[\]:]/g;

export function workbook(sheets: Sheet[], workspace: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const s of sheets) {
    const aoa: (string | number | null)[][] = [[`${brand.legalName} — ${workspace}`], [s.title], [s.subtitle], [], s.columns.map((c) => c.label)];
    for (const r of s.rows) aoa.push(r.cells.map((c) => c ?? ""));
    if (s.notes.length) { aoa.push([]); for (const n of s.notes) aoa.push([n]); }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const total = s.columns.reduce((t, c) => t + (c.weight ?? 1), 0);
    ws["!cols"] = s.columns.map((c) => ({ wch: Math.max(10, Math.round(((c.weight ?? 1) / total) * 110)) }));
    // Real numbers, formatted the Indian way, so a sum in Excel still works.
    for (const addr of Object.keys(ws)) if (!addr.startsWith("!") && ws[addr].t === "n") ws[addr].z = "#,##0.00";
    let name = s.name.replace(SHEET_NAME_BAD, " ").slice(0, 31), i = 2;
    while (used.has(name.toLowerCase())) name = `${s.name.slice(0, 28)} ${i++}`;
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return wb;
}

export function downloadExcel(sheets: Sheet[], workspace: string, fileName: string) {
  XLSX.writeFile(workbook(sheets, workspace), fileName);
}

// ----------------------------------------------------------------------------- PDF
const LEFT = 36, TOP = 36, FOOT = 40;
const LINE = 1.22;

/** Lay the sheets out, one after another, each starting on a fresh page. */
export function drawSheets(doc: jsPDF, sheets: Sheet[], workspace: string, logo: string | null = null) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const RIGHT = W - LEFT, WIDTH = RIGHT - LEFT, BOTTOM = H - FOOT - 14;
  const font = (style: "normal" | "bold", size: number, color: string, family: "body" | "display" = "body") => doc.setFont(family, style).setFontSize(size).setTextColor(color);
  const rule = (y: number, color = C.line, weight = 0.5) => doc.setDrawColor(color).setLineWidth(weight).line(LEFT, y, RIGHT, y);
  const paper = () => { doc.setFillColor(C.white); doc.rect(0, 0, W, H, "F"); doc.setFillColor(C.gold); doc.rect(0, 0, W, 3, "F"); };
  let first = true;

  for (const s of sheets) {
    if (!first) doc.addPage();
    first = false;
    paper();

    // Letterhead: crest, registered name, then what this sheet is.
    let y = TOP + 6;
    crest(doc, logo, LEFT + 15, y + 4, 30);
    font("bold", 12, C.ink, "display"); doc.text(brand.legalName, LEFT + 38, y + 2);
    font("normal", 7.5, C.muted); doc.text(`${workspace}${brand.address ? ` · ${brand.address}` : ""}`, LEFT + 38, y + 12);
    font("bold", 8, C.gold); doc.text(`॥ ${brand.greeting} ॥`, RIGHT, y + 2, { align: "right", charSpace: 1 });
    y += 28; rule(y, C.gold, 0.8); y += 18;
    font("bold", 13, C.heading, "display"); doc.text(s.title.toUpperCase(), LEFT, y, { charSpace: 1 });
    y += 13; font("normal", 9, C.muted); doc.text(s.subtitle, LEFT, y);
    font("normal", 7.5, C.soft); doc.text("Amounts in ₹", RIGHT, y, { align: "right" });
    y += 14;

    // Columns share the width by weight.
    const total = s.columns.reduce((t, c) => t + (c.weight ?? 1), 0);
    const widths = s.columns.map((c) => ((c.weight ?? 1) / total) * WIDTH);
    const xs = widths.reduce<number[]>((acc, w, i) => [...acc, (acc[i] ?? LEFT) + w], [LEFT]);
    const PAD = 4;
    const cellX = (i: number) => (s.columns[i].align === "right" ? xs[i + 1] - PAD : xs[i] + PAD);

    const headerRow = () => {
      doc.setFillColor(C.panel); doc.rect(LEFT, y, WIDTH, 16, "F");
      font("bold", 7.2, C.muted);
      s.columns.forEach((c, i) => doc.text(c.label.toUpperCase(), cellX(i), y + 11, { align: c.align === "right" ? "right" : "left" }));
      y += 16; rule(y, C.line, 0.6);
    };
    const newPage = () => { doc.addPage(); paper(); y = TOP; font("bold", 8, C.muted); doc.text(`${s.title} · ${s.subtitle}`, LEFT, y); font("normal", 7.5, C.soft); doc.text("continued", RIGHT, y, { align: "right" }); y += 8; rule(y, C.gold, 0.8); y += 10; headerRow(); };
    headerRow();

    for (const r of s.rows) {
      const kind = r.kind;
      font(kind === "total" || kind === "head" ? "bold" : "normal", 8.2, kind === "head" ? C.brandDark : kind === "sub" ? C.muted : C.ink);
      // Wrap the text columns; a figure never wraps.
      const wrapped = r.cells.map((c, i) => (typeof c === "string" && s.columns[i].align !== "right" ? (doc.splitTextToSize(c, widths[i] - PAD * 2) as string[]) : [show(c)]));
      const lines = Math.max(1, ...wrapped.map((w) => w.length));
      const h = lines * 8.2 * LINE + 6;
      if (y + h > BOTTOM) newPage();
      if (kind === "head") { doc.setFillColor(C.panel); doc.rect(LEFT, y, WIDTH, h, "F"); }
      if (kind === "total") rule(y, C.ink, 0.6);
      font(kind === "total" || kind === "head" ? "bold" : "normal", 8.2, kind === "head" ? C.brandDark : kind === "sub" ? C.muted : C.ink);
      wrapped.forEach((w, i) => { if (w.join("")) doc.text(w, cellX(i), y + 9, { align: s.columns[i].align === "right" ? "right" : "left" }); });
      y += h;
      if (kind !== "head") rule(y, C.track, 0.4);
    }

    if (s.notes.length) {
      y += 10;
      font("normal", 7.6, C.muted);
      for (const n of s.notes) {
        const ls = doc.splitTextToSize(n, WIDTH) as string[];
        if (y + ls.length * 10 > BOTTOM) newPage();
        doc.text(ls, LEFT, y + 6); y += ls.length * 10 + 2;
      }
    }
  }

  const stamp = stampNow(), pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    rule(H - FOOT, C.line);
    font("normal", 7, C.soft);
    doc.text(`${brand.legalName} · ${brand.app}`, LEFT, H - FOOT + 11);
    doc.text(`Page ${p} of ${pages}`, RIGHT, H - FOOT + 11, { align: "right" });
    doc.text(`all glories to Śrīla Prabhupāda · generated ${stamp}`, W / 2, H - FOOT + 22, { align: "center" });
  }
}

export async function sheetsPdf(sheets: Sheet[], workspace: string, title: string): Promise<jsPDF> {
  const [doc, logo] = await Promise.all([blankDoc("landscape"), loadLogo()]);
  drawSheets(doc, sheets, workspace, logo);
  doc.setDocumentProperties({ title: `${brand.name} · ${title}`, subject: `${workspace} — ${title}`, author: brand.legalName, creator: `${brand.name} ${brand.app}` });
  return doc;
}

export async function downloadPdf(sheets: Sheet[], workspace: string, title: string, fileName: string) {
  (await sheetsPdf(sheets, workspace, title)).save(fileName);
}
