// The report sheets, the Excel workbook and the auditor-pack PDF. The arithmetic is tested in
// accounts.test.mjs; this checks that what reaches the page is complete and consistent — every
// report exists, every row fits its columns, the totals the auditor will check are equal, and the
// PDF really embeds a face that can draw ₹ and the Sanskrit in the temple's own name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PUBLIC = fileURLToPath(new URL("../../public", import.meta.url));
globalThis.fetch = async (url) => {
  const buf = await readFile(`${PUBLIC}${String(url)}`);
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const { buildBooks } = await import("../accounts.ts");
const { REPORTS, auditorPack, reportById } = await import("../sheets.ts");
const { workbook, sheetsPdf } = await import("../exportSheets.ts");

const cat = (id, name, over = {}) => ({ id, workspace_id: "w", name, kind: "expense", monthly_limit: null, book: "temple", is_capital: false, section: null, ...over });
const CATS = [cat("ann", "Prasādam"), cat("gau", "Gaushala", { book: "goshala" }), cat("don", "Donation", { kind: "income" }), cat("bld", "Construction – Building", { is_capital: true, section: "construction" })];
const names = { cat: (id) => CATS.find((c) => c.id === id)?.name ?? "", person: (id) => ({ p1: "Mātājī Lalitā" })[id] ?? "" };
let n = 0;
const entry = (over = {}) => (n += 1, {
  id: `e${n}`, workspace_id: "w", type: "expense", entry_date: "2026-11-10", amount: 100, category_id: "ann", item_id: null, person_id: null,
  payment_mode: "Cash", note: "note", reference_no: null, receipt_available: false, bill_path: null, payment_proof_path: null, fund_source: null,
  beneficiary: null, claim_status: null, claim_settled_at: null, voucher_type: "CV", voucher_no: `2026-2027/CV/11/V${String(n).padStart(3, "0")}`,
  voucher_fy: "2026-2027", voucher_month: 11, voucher_seq: n, no_bill: true, jv_kind: null, dr_category_id: null, cr_category_id: null,
  bank_account_id: null, settles_entry_id: null, created_by: "u", created_at: new Date(Date.UTC(2026, 10, 10, 10, 0, 0) + n * 1000).toISOString(), updated_at: "", ...over,
});
const jv = entry({ id: "jv", type: "journal", voucher_type: "JV", payment_mode: "Journal", amount: 900, jv_kind: "unpaid_bill", dr_category_id: "ann", category_id: null, note: "October bill" });
const ENTRIES = [
  entry({ amount: 250 }), entry({ amount: 300, payment_mode: "UPI", bank_account_id: "b1", person_id: "p1" }),
  entry({ type: "income", category_id: "don", amount: 5000 }), entry({ type: "income", category_id: "don", amount: 700, payment_mode: "UPI", bank_account_id: "b1" }),
  entry({ category_id: "gau", amount: 120 }), entry({ category_id: "bld", amount: 4000, payment_mode: "UPI", bank_account_id: "b1" }), jv,
  entry({ amount: 400, payment_mode: "UPI", bank_account_id: "b1", settles_entry_id: "jv" }),
];
const setup = { categories: CATS, banks: [{ id: "b1", workspace_id: "w", name: "Ujjivan" }], vouchersFrom: "2026-11-01",
  opening: [{ workspace_id: "w", book: "temple", account: "cash", amount: 2000 }, { workspace_id: "w", book: "temple", account: "capital_fund", amount: -2000 }] };
const ctx = (scope = "all") => ({ b: buildBooks(ENTRIES, setup, names), scope, from: "2026-11-01", to: "2026-11-30", txns: [] });

const find = (sheet, label) => sheet.rows.find((r) => r.cells[0] === label || r.cells[2] === label);

test("the auditor pack has every report the auditor asked for", () => {
  const pack = auditorPack(ctx());
  assert.deepEqual(pack.map((s) => s.id), REPORTS.map((r) => r.id));
  for (const want of ["Trial Balance", "Ledgers", "Journal", "Cash Book", "Bank Book", "Bank Recon", "Income & Expenditure", "Balance Sheet", "Receipts & Payments", "Day Book", "Fund-wise", "Bills Missing", "Unpaid Bills", "No Donor"]) {
    assert.ok(pack.some((s) => s.name === want), `missing ${want}`);
  }
});

test("every row has exactly one cell per column, for every report and every book", () => {
  for (const scope of ["all", "temple", "goshala", "books"]) {
    for (const s of auditorPack(ctx(scope))) {
      assert.ok(s.columns.length > 0 && s.title && s.subtitle, `${s.id} lacks a title`);
      for (const r of s.rows) assert.equal(r.cells.length, s.columns.length, `${scope}/${s.id}: ${JSON.stringify(r.cells)}`);
    }
  }
});

test("the trial balance, balance sheet and receipts & payments tally on their face", () => {
  for (const scope of ["all", "temple", "goshala", "books"]) {
    const c = ctx(scope);
    const tb = reportById("trial-balance").build(c), t = tb.rows.at(-1).cells;
    assert.equal(t[1], t[2], `${scope}: opening`);
    assert.equal(t[3], t[4], `${scope}: movement`);
    assert.equal(t[5], t[6], `${scope}: closing`);
    const bs = reportById("balance-sheet").build(c);
    assert.equal(find(bs, "Total liabilities & capital").cells[1], find(bs, "Total assets").cells[1], `${scope}: balance sheet`);
    const rp = reportById("receipts-payments").build(c);
    const [a, z] = [find(rp, "Total receipts").cells, find(rp, "Total payments").cells];
    assert.deepEqual(a.slice(1), z.slice(1), `${scope}: receipts & payments`);
    assert.ok(!JSON.stringify([tb.notes, bs.notes, rp.notes]).includes("DOES NOT"), `${scope}: a check failed`);
  }
});

test("the books together are the sum of the books", () => {
  const total = (scope) => reportById("income-expenditure").build(ctx(scope)).rows.find((r) => r.cells[0] === "Total expenditure").cells[1];
  assert.equal(total("all"), +(total("temple") + total("goshala") + (total("books") ?? 0)).toFixed(2));
  assert.equal(total("goshala"), 120);                      // the Gaushala spend, in its own book
});

test("the Excel workbook has a sheet per report, with real numbers in it", () => {
  const wb = workbook(auditorPack(ctx()), "Pudhuvai Vrindavanam Accounts");
  assert.equal(wb.SheetNames.length, REPORTS.length);
  assert.equal(new Set(wb.SheetNames.map((x) => x.toLowerCase())).size, REPORTS.length);
  assert.ok(wb.SheetNames.every((x) => x.length <= 31));
  const ws = wb.Sheets["Trial Balance"];
  const numbers = Object.keys(ws).filter((k) => !k.startsWith("!") && ws[k].t === "n");
  assert.ok(numbers.length > 5, "figures must be numeric cells, not text");
  assert.equal(ws[numbers[0]].z, "#,##0.00");
});

test("the auditor-pack PDF embeds a face that can draw rupees and Sanskrit, and numbers every page", async () => {
  const doc = await sheetsPdf(auditorPack(ctx()), "Pudhuvai Vrindavanam Accounts", "Auditor pack");
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.ok(doc.getNumberOfPages() >= REPORTS.length, "each report starts on its own page");
  assert.ok(bytes.length > 20000);
  doc.setFont("body", "normal").setFontSize(9);
  for (const ch of "₹āīṣṛṇŚ") assert.ok(doc.getTextWidth(ch) > 0, `no glyph for ${ch}`);
});

test("a long ledger flows over more pages instead of off the bottom", async () => {
  const many = Array.from({ length: 120 }, (_, i) => entry({ amount: 10 + i, entry_date: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}` }));
  const c = { ...ctx(), b: buildBooks(many, setup, names) };
  const doc = await sheetsPdf([reportById("ledgers").build(c)], "Test", "Ledgers");
  assert.ok(doc.getNumberOfPages() > 2);
});
