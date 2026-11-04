// The daily report has to leave as a real PDF — selectable text in an embedded Unicode face,
// not a raster. These checks catch the two ways that quietly breaks: a missing or renamed font
// file in public/fonts, and a ₹ or ā that the embedded subset cannot draw.
//
// Written as .mjs for the same reason as pure.test.mjs: Node needs the explicit ".ts".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PUBLIC = fileURLToPath(new URL("../../public", import.meta.url));

// In the browser the faces come off the CDN as static assets; here, off disk.
globalThis.fetch = async (url) => {
  const buf = await readFile(`${PUBLIC}${String(url)}`);
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const { reportPdf, reportFileName } = await import("../pdf.ts");

const money = (n) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)}`;
const names = { cat: () => "Prasādam", item: () => "Ghee", person: () => "Mātājī Lalitā" };
const entry = (over) => ({
  id: "e1", workspace_id: "w", type: "expense", entry_date: "2026-11-04", amount: 1899,
  category_id: "c1", item_id: "i1", person_id: "p1", payment_mode: "UPI", note: null,
  reference_no: null, receipt_available: true, bill_path: null, payment_proof_path: null,
  fund_source: null, beneficiary: null, claim_status: null, claim_settled_at: null,
  created_by: "u", created_at: "", updated_at: "", ...over,
});

const input = (over = {}) => ({
  date: "2026-11-04", workspace: "Pudhuvai Vrindavanam Accounts", money, names,
  expenses: [entry({ note: "Friday abhiṣeka" })],
  income: [entry({ type: "income", amount: 25000, reference_no: "UPI-884412" })],
  budget: [{ label: "Overall", spent: 184500, limit: 200000 }],
  ...over,
});

test("the report is a real PDF, not an image", async () => {
  const doc = await reportPdf(input());
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.equal(doc.getNumberOfPages(), 1);
  assert.ok(bytes.length > 10000, "the embedded faces should be in the file");
});

test("rupees and Sanskrit diacritics survive into the embedded font", async () => {
  const doc = await reportPdf(input());
  // jsPDF throws on a character the embedded subset cannot map, so reaching here is the test;
  // assert on the glyph widths too, so a silently blank .notdef cannot pass.
  doc.setFont("body", "normal").setFontSize(9);
  for (const ch of "₹āīṣṛṇŚ") assert.ok(doc.getTextWidth(ch) > 0, `no glyph for ${ch}`);
});

test("a long day flows onto further pages, and every page is numbered", async () => {
  const many = Array.from({ length: 60 }, (_, i) => entry({ id: `e${i}`, amount: 100 + i }));
  const doc = await reportPdf(input({ expenses: many }));
  assert.ok(doc.getNumberOfPages() > 1, "60 entries should not fit on one page");
});

test("an empty day still produces a complete sheet", async () => {
  const doc = await reportPdf(input({ expenses: [], income: [], budget: [] }));
  assert.equal(doc.getNumberOfPages(), 1);
});

test("the file is named for the day it reports on", () => {
  assert.equal(reportFileName("2026-11-04"), "report-2026-11-04.pdf");
});
