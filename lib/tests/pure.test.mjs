// Tests for the pure functions with real money and real dates riding on them.
// Run with: npm run test:unit   (Node runs the TypeScript sources directly)
//
// Written as .mjs on purpose: Node needs the explicit ".ts" on the import, which the project's
// tsconfig would otherwise reject, and .mjs files are outside its `include`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDate, rupeesInWords, num, compact, dmy, daysBetween } from "../format.ts";
import { suggest } from "../match.ts";
import { financialYear, voucherKind, formatVoucherNo, voucherPreview, entryHead, VOUCHERS_FROM } from "../voucher.ts";

test("parseDate reads the formats Indian bank statements use", () => {
  assert.equal(parseDate("2026-03-09"), "2026-03-09");
  assert.equal(parseDate("2026/3/9"), "2026-03-09");
  assert.equal(parseDate("09/03/2026"), "2026-03-09");   // day first
  assert.equal(parseDate("9-3-26"), "2026-03-09");
  assert.equal(parseDate("09.03.2026"), "2026-03-09");
  assert.equal(parseDate("09-Mar-2026"), "2026-03-09");
  assert.equal(parseDate("9 March 2026"), "2026-03-09");
  assert.equal(parseDate("09-Mar-26"), "2026-03-09");
});

test("parseDate reads an unambiguous US-format date the right way round", () => {
  // 13 cannot be a month, so this is month/day — the old version stored "2026-13-01".
  assert.equal(parseDate("01/13/2026"), "2026-01-13");
  assert.equal(parseDate("3/9/2026"), "2026-09-03");     // ambiguous: day first, as before
});

test("parseDate refuses dates the calendar does not have", () => {
  assert.equal(parseDate("31/02/2026"), null);           // February has no 31st
  assert.equal(parseDate("29/02/2026"), null);           // 2026 is not a leap year
  assert.equal(parseDate("29/02/2024"), "2024-02-29");   // 2024 is
  assert.equal(parseDate("45/45/2026"), null);
  assert.equal(parseDate("2026-13-01"), null);           // month 13
  assert.equal(parseDate("2026-02-30"), null);
});

test("parseDate gives nothing for nothing", () => {
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("   "), null);
  assert.equal(parseDate("Opening balance"), null);
  assert.equal(parseDate(undefined), null);
});

test("rupeesInWords writes the amount on a voucher", () => {
  assert.equal(rupeesInWords(0), "Zero Rupees Only");
  assert.equal(rupeesInWords(1), "One Rupees Only");
  assert.equal(rupeesInWords(100), "One Hundred Rupees Only");
  assert.equal(rupeesInWords(1234), "One Thousand Two Hundred Thirty Four Rupees Only");
  assert.equal(rupeesInWords(12345.5), "Twelve Thousand Three Hundred Forty Five Rupees and Fifty Paise Only");
  assert.equal(rupeesInWords(100000), "One Lakh Rupees Only");
  assert.equal(rupeesInWords(10000000), "One Crore Rupees Only");
  assert.equal(rupeesInWords(10150000.75), "One Crore One Lakh Fifty Thousand Rupees and Seventy Five Paise Only");
  assert.equal(rupeesInWords(0.05), "Zero Rupees and Five Paise Only");
});

test("num pulls a number out of whatever the spreadsheet had in the cell", () => {
  assert.equal(num("1,234.56"), 1234.56);
  assert.equal(num("₹ 2,000"), 2000);
  assert.equal(num(" 42 "), 42);
  assert.equal(num(""), 0);
  assert.equal(num(null), 0);
  assert.equal(num("not a number"), 0);
  assert.equal(num("-500"), -500);
});

test("compact abbreviates the Indian way", () => {
  assert.equal(compact(999), "999");
  assert.equal(compact(1500), "1.5k");
  assert.equal(compact(250000), "2.5L");
  assert.equal(compact(35000000), "3.5Cr");
  assert.equal(compact(-1500), "-1.5k");
});

test("dmy and daysBetween", () => {
  assert.equal(dmy("2026-03-09"), "09/03/2026");
  assert.equal(daysBetween("2026-03-09", "2026-03-12"), 3);
  assert.equal(daysBetween("2026-03-12", "2026-03-09"), 3);
  assert.equal(daysBetween("2026-03-09", "2026-03-09"), 0);
});

// ---------------------------------------------------------------- reconciliation scoring
const entry = (over = {}) => ({
  id: "e1", workspace_id: "w", type: "expense", entry_date: "2026-03-09", amount: 1000,
  category_id: null, item_id: null, person_id: null, payment_mode: "UPI", note: null,
  reference_no: null, receipt_available: false, bill_path: null, payment_proof_path: null,
  fund_source: null, beneficiary: null, claim_status: null, claim_settled_at: null,
  created_by: "u", created_at: "", updated_at: "", ...over,
});
const txn = (over = {}) => ({
  id: "t1", workspace_id: "w", txn_date: "2026-03-09", description: null, reference: null,
  amount: 1000, direction: "debit", matched_entry_id: null, ...over,
});
const noNames = () => "";

test("suggest only offers entries that could match the direction", () => {
  // A debit leaving the bank can only be an expense, never income.
  assert.deepEqual(suggest(txn({ direction: "debit" }), [entry({ type: "income" })], noNames), []);
  assert.deepEqual(suggest(txn({ direction: "credit" }), [entry({ type: "expense" })], noNames), []);
  assert.equal(suggest(txn({ direction: "credit" }), [entry({ type: "income" })], noNames).length, 1);
});

test("suggest never offers a journal voucher: no money moved through the bank", () => {
  // A journal is neither "expense" nor "income", so on a credit row the direction test alone
  // (false === false) would have let it through.
  assert.deepEqual(suggest(txn({ direction: "credit" }), [entry({ type: "journal" })], noNames), []);
  assert.deepEqual(suggest(txn({ direction: "debit" }), [entry({ type: "journal" })], noNames), []);
});

test("suggest scores the amount and the day", () => {
  const [best] = suggest(txn(), [entry()], noNames);
  assert.equal(best.score, 70);                               // 50 amount + 20 same day
  assert.ok(best.reasons.includes("Amount matches"));
  assert.ok(best.reasons.includes("Same day"));

  const [near] = suggest(txn({ txn_date: "2026-03-11" }), [entry()], noNames);
  assert.equal(near.score, 60);                               // 50 amount + 10 within three days
});

test("suggest trusts a UTR found in the statement text above all else", () => {
  const e = entry({ amount: 999, reference_no: "412345678901" });
  const t = txn({ description: "UPI/412345678901/GROCER", amount: 1000 });
  const [best] = suggest(t, [e], noNames);
  assert.ok(best.reasons.includes("UTR found in statement"));
  assert.ok(best.score >= 60);
});

test("suggest ignores a reference too short to be meaningful", () => {
  // "12" appears in the narration, but a two-character reference matches by luck, not by identity.
  const e = entry({ amount: 7, reference_no: "12" });
  const t = txn({ description: "payment 12 of many", amount: 999 });
  const [only] = suggest(t, [e], noNames);
  assert.ok(!only.reasons.includes("UTR found in statement"));
  assert.equal(only.score, 20);   // the same-day bonus alone, with nothing for the reference
});

test("suggest puts the strongest candidate first", () => {
  const weak = entry({ id: "weak", amount: 500 });
  const strong = entry({ id: "strong", amount: 1000 });
  const ranked = suggest(txn({ amount: 1000 }), [weak, strong], noNames);
  assert.equal(ranked[0].entry.id, "strong");
});

// ---------------------------------------------------------------- vouchers
// The same examples the database tests use (supabase/tests/rls.test.sql), so the two stay in step.

test("the financial year runs April to March", () => {
  assert.equal(financialYear("2026-11-19"), "2026-2027");
  assert.equal(financialYear("2027-03-31"), "2026-2027");   // last day of the year
  assert.equal(financialYear("2027-04-01"), "2027-2028");   // first day of the next
  assert.equal(financialYear("2027-01-01"), "2026-2027");   // January belongs to the year that began the April before
});

test("cash is cash; everything else passes through a bank", () => {
  assert.equal(voucherKind("expense", "Cash"), "CV");
  assert.equal(voucherKind("expense", "UPI"), "BV");
  assert.equal(voucherKind("expense", "Bank Transfer"), "BV");
  assert.equal(voucherKind("expense", "Cheque"), "BV");
  assert.equal(voucherKind("expense", "Card"), "BV");
  assert.equal(voucherKind("expense", "Other"), "BV");
  assert.equal(voucherKind("income", "Cash"), "CR");
  assert.equal(voucherKind("income", "UPI"), "BR");
  assert.equal(voucherKind("expense", " cash "), "CV");     // stray spaces and capitals do not matter
  assert.equal(voucherKind("journal", "Journal"), "JV");
  assert.equal(voucherKind("journal", "Cash"), "JV");       // a journal moves no cash whatever the mode says
});

test("a voucher number reads like the paper ones", () => {
  assert.equal(formatVoucherNo("2025-2026", "BV", 5, 18), "2025-2026/BV/05/V018");   // the style the temple already uses
  assert.equal(formatVoucherNo("2026-2027", "CV", 11, 1), "2026-2027/CV/11/V001");
  assert.equal(formatVoucherNo("2026-2027", "BR", 12, 999), "2026-2027/BR/12/V999");
  assert.equal(formatVoucherNo("2026-2027", "BR", 12, 1000), "2026-2027/BR/12/V1000"); // never cut short
});

test("a new entry says which voucher it will be, from the first of November 2026", () => {
  assert.equal(VOUCHERS_FROM, "2026-11-01");
  assert.deepEqual(voucherPreview("expense", "UPI", "2026-11-19"), { kind: "BV", label: "Bank Voucher", series: "2026-2027/BV/11" });
  assert.equal(voucherPreview("expense", "Cash", "2026-11-01")?.kind, "CV");     // the first day counts
  assert.equal(voucherPreview("expense", "Cash", "2026-10-31"), null);           // the day before does not
  assert.equal(voucherPreview("expense", "Cash", ""), null);                     // no date yet
  assert.equal(voucherPreview("income", "Cash", "2026-11-19", null), null);      // numbering switched off
  assert.equal(voucherPreview("journal", "Journal", "2027-04-02")?.series, "2027-2028/JV/04");
});

test("a ledger row names the two heads of a journal", () => {
  const cat = (id) => ({ a: "Gaushala", b: "Festival" })[id] ?? "";
  assert.equal(entryHead(entry({ type: "expense", category_id: "a" }), cat), "Gaushala");
  assert.equal(entryHead(entry({ type: "journal", jv_kind: "transfer", dr_category_id: "b", cr_category_id: "a" }), cat), "Dr Festival · Cr Gaushala");
  assert.equal(entryHead(entry({ type: "journal", jv_kind: "unpaid_bill", dr_category_id: "b", cr_category_id: null }), cat), "Dr Festival · Cr Outstanding expenses");
});
