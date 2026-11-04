/**
 * The daily seva report, as a real PDF.
 *
 * It used to leave as a PNG raster of the on-screen card (html-to-image), which meant the
 * report could not be searched, selected, pasted into an email or read aloud, and went
 * soft the moment anyone printed it. Everything below is laid out as vector text and
 * shapes instead, so what a devotee downloads is an ordinary A4 document: real headings,
 * selectable figures, a sharp crest at any zoom, page numbers and PDF metadata.
 *
 * jsPDF's built-in faces are WinAnsi-only — no ₹, no Ṛ/ṣ/ā — so the three subsetted Noto
 * faces in `public/fonts` are fetched on first use and embedded in the file. They are
 * served as static assets rather than imported, and the report screen pulls this module
 * (and jsPDF with it) in only when someone actually asks for a PDF, so neither the fonts
 * nor the generator weigh on first paint. `docs/pdf-fonts.md` records how they were built.
 */
import { jsPDF } from "jspdf";
import { brand } from "./brand";
import { dmy } from "./format";
import type { Entry } from "./types";

type Names = { cat: (id: string | null) => string; item: (id: string | null) => string; person: (id: string | null) => string };

export type ReportInput = {
  /** YYYY-MM-DD, the day being reported. */
  date: string;
  /** Workspace name, printed under the letterhead. */
  workspace: string;
  expenses: Entry[];
  income: Entry[];
  /** Month-to-date budget bars, in the order they should appear. */
  budget: { label: string; spent: number; limit: number }[];
  money: (n: number) => string;
  names: Names;
};

/* ---- The Temple Ledger palette, as literal hex ---------------------------------------
   A PDF has no CSS variables to resolve, and these must match app/globals.css. */
const C = {
  ink: "#2a2119", muted: "#7b6a56", soft: "#a2927c", line: "#e9dcc7", panel: "#faf5ec",
  track: "#f3ebdd", gold: "#b8912a", saffron: "#e8913b", brand: "#b85410", brandDark: "#96430b",
  green: "#1f7a46", amber: "#d99100", red: "#a82b25", white: "#ffffff", heading: "#3f3528",
};

/* ---- Page geometry, in points (A4) ---- */
const PAGE_W = 595.28, PAGE_H = 841.89;
const LEFT = 48, RIGHT = PAGE_W - 48, WIDTH = RIGHT - LEFT;
const TOP = 48;
/** Last baseline a row may occupy before it has to move to the next page. */
const BOTTOM = PAGE_H - 74;
/** Right edge of the payment-mode column, and what that leaves for the particulars. */
const MODE_R = RIGHT - 84;
const PART_W = MODE_R - 66 - LEFT;
/** Income has no mode column, so its particulars run wider. */
const INCOME_W = RIGHT - 84 - LEFT;
/** Matches the leading jsPDF gives a multi-line doc.text(); see setLineHeightFactor below. */
const LINE = 1.22;
const lh = (size: number) => size * LINE;

const FONTS = [
  { file: "NotoSans-Regular.ttf", family: "body", style: "normal" },
  { file: "NotoSans-SemiBold.ttf", family: "body", style: "bold" },
  { file: "NotoSerif-Bold.ttf", family: "display", style: "bold" },
] as const;

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  // Chunked: spreading 46k arguments into fromCharCode overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let fontFiles: Promise<string[]> | null = null;
/** Fetch the embedded faces once per session; a failure is not cached, so a retry can work. */
function loadFonts() {
  fontFiles ??= Promise.all(
    FONTS.map(async (f) => {
      const res = await fetch(`/fonts/${f.file}`);
      if (!res.ok) throw new Error(`could not load ${f.file} (HTTP ${res.status})`);
      return toBase64(await res.arrayBuffer());
    }),
  ).catch((e) => { fontFiles = null; throw e; });
  return fontFiles;
}

/* ---- The lotus crest, drawn rather than pasted ---------------------------------------
   Same petals as components/Brand.tsx, so the letterhead mark is the app's mark. */
const PETAL_OUTER: [number, number][] = [[32, 4.5], [41.5, 15], [42, 25], [32, 31.5], [22, 25], [22.5, 15], [32, 4.5]];
const PETAL_INNER: [number, number][] = [[32, 14], [38, 21], [38, 27], [32, 32], [26, 27], [26, 21], [32, 14]];
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function lotus(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size / 64; // the source mark is drawn in a 64x64 box
  const at = (p: [number, number], deg: number): [number, number] => {
    const r = (deg * Math.PI) / 180, dx = p[0] - 32, dy = p[1] - 32;
    return [cx + (dx * Math.cos(r) - dy * Math.sin(r)) * s, cy + (dx * Math.sin(r) + dy * Math.cos(r)) * s];
  };
  const petal = (pts: [number, number][], deg: number) => {
    const q = pts.map((p) => at(p, deg));
    doc.moveTo(q[0][0], q[0][1]);
    doc.curveTo(q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]);
    doc.curveTo(q[4][0], q[4][1], q[5][0], q[5][1], q[6][0], q[6][1]);
    doc.close();
    doc.fill();
  };
  doc.setFillColor(C.saffron); ANGLES.forEach((a) => petal(PETAL_OUTER, a));
  doc.setFillColor(C.brand); ANGLES.forEach((a) => petal(PETAL_INNER, a + 22.5));
  doc.setFillColor(C.gold); doc.circle(cx, cy, 7 * s, "F");
  doc.setFillColor(C.white); doc.circle(cx, cy, 3 * s, "F");
}

async function blankDoc() {
  const files = await loadFonts();
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  FONTS.forEach((f, i) => { doc.addFileToVFS(f.file, files[i]); doc.addFont(f.file, f.family, f.style); });
  doc.setLineHeightFactor(LINE);
  return doc;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Local time, not toISOString(): a report built at 11pm IST must not be stamped tomorrow. */
function stampNow() {
  const n = new Date();
  return `${pad2(n.getDate())}/${pad2(n.getMonth() + 1)}/${n.getFullYear()} ${pad2(n.getHours())}:${pad2(n.getMinutes())}`;
}

function draw(doc: jsPDF, d: ReportInput) {
  const { money, names } = d;
  const sum = (l: Entry[]) => l.reduce((s, r) => s + r.amount, 0);
  let y = 0;

  const font = (family: "body" | "display", style: "normal" | "bold", size: number, color: string) =>
    doc.setFont(family, style).setFontSize(size).setTextColor(color);
  const rule = (at: number, color = C.line, weight = 0.6) =>
    doc.setDrawColor(color).setLineWidth(weight).line(LEFT, at, RIGHT, at);
  // A PDF page is transparent unless something is painted on it, which some thumbnailers
  // and converters turn into black. Lay a white sheet down first, then the gold top edge.
  const sheet = () => {
    doc.setFillColor(C.white); doc.rect(0, 0, PAGE_W, PAGE_H, "F");
    doc.setFillColor(C.gold); doc.rect(0, 0, PAGE_W, 3, "F");
  };

  /** Full letterhead: crest, registered name, workspace, title, date. Page 1 only. */
  function letterhead() {
    sheet();
    let t = TOP + 4;
    font("body", "normal", 7.5, C.gold);
    doc.text(`॥ ${brand.greeting} ॥`, PAGE_W / 2, t, { align: "center", charSpace: 2 });

    t += 22;
    const crest = 27;
    font("display", "bold", 13, C.ink);
    const nameW = doc.getTextWidth(brand.legalName);
    font("body", "normal", 7.5, C.muted);
    const addrW = brand.address ? doc.getTextWidth(brand.address) : 0;
    const x = (PAGE_W - (crest + 9 + Math.max(nameW, addrW))) / 2;
    lotus(doc, x + crest / 2, t + 1, crest);
    font("display", "bold", 13, C.ink);
    doc.text(brand.legalName, x + crest + 9, t - 1);
    if (brand.address) {
      font("body", "normal", 7.5, C.muted);
      doc.text(brand.address, x + crest + 9, t + 9);
    }

    t += 22;
    rule(t, C.gold, 0.8);
    t += 15;
    font("body", "bold", 9.5, C.muted);
    doc.text(d.workspace, PAGE_W / 2, t, { align: "center" });
    t += 16;
    font("display", "bold", 12, C.heading);
    doc.text("DAILY SEVA REPORT", PAGE_W / 2, t, { align: "center", charSpace: 1.6 });
    t += 13;
    font("body", "normal", 8.5, C.muted);
    doc.text(dmy(d.date), PAGE_W / 2, t, { align: "center" });
    return t + 20;
  }

  /** Slim running head, so a page that arrives on its own still says what it is. */
  function continued() {
    sheet();
    let t = TOP;
    font("body", "bold", 8.5, C.muted);
    doc.text(`${d.workspace} · Daily seva report · ${dmy(d.date)}`, LEFT, t);
    font("body", "normal", 8, C.soft);
    doc.text("continued", RIGHT, t, { align: "right" });
    t += 6;
    rule(t, C.gold, 0.8);
    return t + 16;
  }

  const ensure = (need: number) => { if (y + need > BOTTOM) { doc.addPage(); y = continued(); } };

  function heading(numeral: string, label: string) {
    ensure(48);
    y += 15;
    font("display", "bold", 10.5, C.heading);
    doc.text(`${numeral}. ${label}`, LEFT, y);
    y += 5;
    rule(y, C.gold, 0.8);
    y += 14;
  }

  /** Column captions, repeated under each table heading. */
  function captions(withMode: boolean) {
    font("body", "normal", 6.8, C.soft);
    doc.text("PARTICULARS", LEFT, y, { charSpace: 1 });
    if (withMode) doc.text("MODE", MODE_R, y, { align: "right", charSpace: 1 });
    doc.text("AMOUNT", RIGHT, y, { align: "right", charSpace: 1 });
    y += 4;
    rule(y);
    y += 2;
  }

  function emptyNote(text: string) {
    font("body", "normal", 8.5, C.soft);
    doc.text(text, LEFT, y + 9);
    y += 18;
  }

  /** One ledger line. `mode` is omitted for income, which has no mode column. */
  function line(title: string, note: string | null, amount: number, mode: string | null, width: number) {
    font("body", "normal", 9, C.ink);
    const head = doc.splitTextToSize(title || "—", width) as string[];
    let sub: string[] = [];
    if (note) {
      font("body", "normal", 7.5, C.soft);
      sub = doc.splitTextToSize(note, width) as string[];
    }
    const height = head.length * lh(9) + sub.length * lh(7.5) + 7;
    ensure(height);
    const first = y + 9;
    font("body", "normal", 9, C.ink);
    doc.text(head, LEFT, first);
    if (mode) {
      font("body", "normal", 8, C.muted);
      doc.text(mode, MODE_R, first, { align: "right" });
    }
    font("body", "bold", 9, C.ink);
    doc.text(money(amount), RIGHT, first, { align: "right" });
    if (sub.length) {
      font("body", "normal", 7.5, C.soft);
      doc.text(sub, LEFT, first + head.length * lh(9));
    }
    y += height;
    rule(y);
  }

  y = letterhead();

  /* ---- Summary band ---- */
  const expTotal = sum(d.expenses), incTotal = sum(d.income);
  const tiles: [string, string, string][] = [
    ["Expenses", money(expTotal), C.ink],
    ["Income", money(incTotal), C.green],
    ["Entries", String(d.expenses.length + d.income.length), C.ink],
  ];
  const gap = 10, tileW = (WIDTH - gap * 2) / 3, tileH = 40;
  ensure(tileH);
  tiles.forEach(([label, value, colour], i) => {
    const x = LEFT + i * (tileW + gap);
    doc.setFillColor(C.panel).setDrawColor(C.line).setLineWidth(0.6);
    doc.roundedRect(x, y, tileW, tileH, 4, 4, "FD");
    font("body", "normal", 6.8, C.muted);
    doc.text(label.toUpperCase(), x + tileW / 2, y + 14, { align: "center", charSpace: 1.1 });
    font("body", "bold", 13, colour);
    doc.text(value, x + tileW / 2, y + 31, { align: "center" });
  });
  y += tileH;

  /* ---- I. Purchases, grouped by the member who spent (as on screen) ---- */
  heading("I", "Purchases");
  captions(true);
  const byPerson = new Map<string, Entry[]>();
  for (const e of d.expenses) {
    const key = e.person_id ?? "";
    byPerson.set(key, [...(byPerson.get(key) ?? []), e]);
  }
  for (const [id, rows] of byPerson) {
    ensure(54); // band + its first line, so a name is never stranded alone
    y += 5;
    doc.setFillColor(C.panel);
    doc.rect(LEFT, y, WIDTH, 17, "F");
    font("body", "bold", 9, C.brandDark);
    doc.text(names.person(id || null) || "Unassigned", LEFT + 6, y + 12);
    doc.text(money(sum(rows)), RIGHT - 6, y + 12, { align: "right" });
    y += 19;
    for (const e of rows) {
      line([names.cat(e.category_id), names.item(e.item_id)].filter(Boolean).join(" · "), e.note, e.amount, e.payment_mode, PART_W);
    }
    y += 4;
  }
  if (!d.expenses.length) emptyNote("No expenses on this day.");

  /* ---- II. Income, only when there is some (the screen numbers the same way) ---- */
  if (d.income.length) {
    heading("II", "Income");
    captions(false);
    for (const e of d.income) {
      const who = names.person(e.person_id);
      const title = [names.cat(e.category_id), who].filter(Boolean).join(" · ") + (e.reference_no ? ` (#${e.reference_no})` : "");
      line(title, e.note, e.amount, null, INCOME_W);
    }
  }

  /* ---- III. Budget, as drawn bars ---- */
  heading("III", "Budget (month to date)");
  if (!d.budget.length) emptyNote("No monthly limits have been set for this workspace.");
  for (const b of d.budget) {
    ensure(28);
    const over = b.spent > b.limit;
    const pct = b.limit > 0 ? Math.min(100, (b.spent / b.limit) * 100) : 0;
    font("body", "normal", 9, C.ink);
    doc.text(b.label, LEFT, y + 9);
    font("body", "bold", 9, over ? C.red : C.ink);
    doc.text(`${money(b.spent)} / ${money(b.limit)}`, RIGHT, y + 9, { align: "right" });
    const bar = y + 14;
    doc.setFillColor(C.track);
    doc.roundedRect(LEFT, bar, WIDTH, 5, 2.5, 2.5, "F");
    if (pct > 0) {
      doc.setFillColor(over ? C.red : pct > 80 ? C.amber : C.green);
      doc.roundedRect(LEFT, bar, Math.max((WIDTH * pct) / 100, 4), 5, 2.5, 2.5, "F");
    }
    y += 28;
  }

  /* ---- Footer on every page, once the page count is known ---- */
  const stamp = stampNow();
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    rule(PAGE_H - 54);
    font("body", "normal", 7, C.soft);
    doc.text(`${brand.legalName} · ${brand.app}`, LEFT, PAGE_H - 44);
    doc.text(`Page ${p} of ${pages}`, RIGHT, PAGE_H - 44, { align: "right" });
    doc.text(`all glories to Śrīla Prabhupāda · generated ${stamp}`, PAGE_W / 2, PAGE_H - 33, { align: "center" });
  }

  doc.setDocumentProperties({
    title: `${brand.name} · Daily seva report · ${dmy(d.date)}`,
    subject: `${d.workspace} — daily seva report for ${dmy(d.date)}`,
    author: brand.legalName,
    creator: `${brand.name} ${brand.app}`,
  });
}

export const reportFileName = (date: string) => `report-${date}.pdf`;

/** Build the report. Exported on its own so a test can inspect the document. */
export async function reportPdf(d: ReportInput): Promise<jsPDF> {
  const doc = await blankDoc();
  draw(doc, d);
  return doc;
}

/** Build the report and hand it to the browser as a download. */
export async function downloadReportPdf(d: ReportInput): Promise<void> {
  const doc = await reportPdf(d);
  doc.save(reportFileName(d.date));
}
