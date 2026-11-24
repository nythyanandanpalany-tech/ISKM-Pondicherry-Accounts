// Tests for the weekly settlement: a calendar week is settled when the bank is matched, the cash is
// counted, the trial balance tallies and the bills are attached (lib/settlement.ts).
// Run with: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBooks } from "../accounts.ts";
import { weekRange } from "../periods.ts";
import { cashAt, checkWeek, indiaToday, statusOf, weeksSince } from "../settlement.ts";

const cat = (id, name, over = {}) => ({ id, workspace_id: "w", name, kind: "expense", monthly_limit: null, book: "temple", is_capital: false, section: null, ...over });
const CATS = [cat("annadanam", "Annadanam"), cat("gaushala", "Gaushala", { book: "goshala" }), cat("donation", "Donation", { kind: "income" })];
const names = { cat: (id) => CATS.find((c) => c.id === id)?.name ?? "", person: () => "" };
const setup = (over = {}) => ({ categories: CATS, banks: [{ id: "b1", workspace_id: "w", name: "Ujjivan" }], opening: [], vouchersFrom: "2026-11-01", ...over });

let n = 0;
const entry = (over = {}) => {
  n += 1;
  return {
    id: `e${n}`, workspace_id: "w", type: "expense", entry_date: "2026-11-03", amount: 100, category_id: "annadanam", item_id: null,
    person_id: null, payment_mode: "Cash", note: `n${n}`, reference_no: null, receipt_available: true, bill_path: "bill.jpg",
    payment_proof_path: null, fund_source: null, beneficiary: null, claim_status: null, claim_settled_at: null,
    voucher_type: "CV", voucher_no: `V${n}`, voucher_fy: "2026-2027", voucher_month: 11, voucher_seq: n, no_bill: false,
    jv_kind: null, dr_category_id: null, cr_category_id: null, bank_account_id: null, settles_entry_id: null,
    created_by: "u", created_at: `2026-11-03T10:00:${String(n % 60).padStart(2, "0")}Z`, updated_at: `2026-11-03T10:00:${String(n % 60).padStart(2, "0")}Z`, ...over,
  };
};
const txn = (over = {}) => ({ id: `t${++n}`, workspace_id: "w", txn_date: "2026-11-04", description: "UPI", reference: null, amount: 200, direction: "debit", matched_entry_id: null, ...over });
const WEEK = weekRange("2026-11-03");                       // Monday 2 – Sunday 8 November 2026
const AFTER = "2026-11-20";
const saved = (over = {}) => ({ workspace_id: "w", week_start: WEEK.from, cash_counted: null, cash_note: null, counted_by: null, counted_at: null, settled_by: null, settled_at: null, snapshot: null, ...over });
const check = (entries, txns = [], row, today = AFTER, s = setup()) => checkWeek(buildBooks(entries, s, names), txns, WEEK, row, today);

test("the weeks run Monday to Sunday, from the week the vouchers start to this one, newest first", () => {
  const w = weeksSince("2026-11-01", "2026-11-24");
  assert.deepEqual(w.map((x) => x.from), ["2026-11-23", "2026-11-16", "2026-11-09", "2026-11-02", "2026-10-26"]);
  assert.equal(w[0].to, "2026-11-29");
  assert.equal(WEEK.from, "2026-11-02"); assert.equal(WEEK.to, "2026-11-08");
});

test("today is India's date, not UTC's", () => {
  assert.equal(indiaToday(new Date("2026-11-08T20:00:00Z")), "2026-11-09");          // 1:30 am Monday in India
  assert.equal(indiaToday(new Date("2026-11-08T18:00:00Z")), "2026-11-08");
});

test("a clean week: bank matched, cash counted right, tallies, bills attached — ready to settle", () => {
  const cv = entry({ amount: 100 });
  const bv = entry({ amount: 200, payment_mode: "UPI", bank_account_id: "b1", voucher_type: "BV" });
  const cr = entry({ type: "income", amount: 500, category_id: "donation", receipt_available: false, bill_path: null, voucher_type: "CR" });
  const s = setup({ opening: [{ workspace_id: "w", book: "temple", account: "cash", amount: 1000 }, { workspace_id: "w", book: "temple", account: "capital_fund", amount: -1000 }] });
  const books = buildBooks([cv, bv, cr], s, names);
  assert.equal(cashAt(books, WEEK.to), 1000 - 100 + 500);
  const c = check([cv, bv, cr], [txn({ matched_entry_id: bv.id })], saved({ cash_counted: 1400 }), AFTER, s);
  assert.ok(c.bank.ok); assert.equal(c.bank.vouchers, 1); assert.equal(c.bank.matched, 1);
  assert.ok(c.cash.ok); assert.equal(c.cash.difference, 0);
  assert.ok(c.tb.ok); assert.equal(c.tb.books.length, 4);
  assert.ok(c.bills.ok);
  assert.ok(c.ready); assert.equal(statusOf(c), "ready");
});

test("bank: an unmatched bank voucher, or a statement row with no entry, keeps the week open", () => {
  const bv = entry({ payment_mode: "UPI", bank_account_id: "b1" });
  let c = check([bv], [], saved({ cash_counted: 0 }));
  assert.equal(c.bank.ok, false); assert.equal(c.bank.unmatchedVouchers[0].voucherNo, bv.voucher_no);
  c = check([bv], [txn({ matched_entry_id: bv.id }), txn({ txn_date: "2026-11-06", description: "NEFT from donor", direction: "credit" })], saved({ cash_counted: 0 }));
  assert.equal(c.bank.ok, false); assert.equal(c.bank.unmatchedVouchers.length, 0);
  assert.equal(c.bank.unmatchedStatement[0].text, "NEFT from donor"); assert.equal(c.bank.unmatchedStatement[0].direction, "in");
  // A statement row from another week is that week's business.
  c = check([bv], [txn({ matched_entry_id: bv.id }), txn({ txn_date: "2026-11-10" })], saved({ cash_counted: 0 }));
  assert.ok(c.bank.ok);
});

test("bank: cash vouchers and journals need no statement row", () => {
  const c = check([entry(), entry({ type: "journal", payment_mode: "Journal", category_id: null, jv_kind: "unpaid_bill", dr_category_id: "annadanam", voucher_type: "JV" })], [], saved({ cash_counted: 0 }));
  assert.ok(c.bank.ok); assert.equal(c.bank.vouchers, 0);
});

test("cash: not counted yet, or counted wrong, keeps the week open; the difference is signed", () => {
  const es = [entry({ type: "income", amount: 500, category_id: "donation" }), entry({ amount: 120 })];
  let c = check(es, [], undefined);
  assert.equal(c.cash.ok, false); assert.equal(c.cash.counted, null); assert.equal(c.cash.book, 380);
  c = check(es, [], saved({ cash_counted: 350 }));
  assert.equal(c.cash.ok, false); assert.equal(c.cash.difference, -30);
  c = check(es, [], saved({ cash_counted: "380.00" }));                                // numeric comes back from PostgREST as a string
  assert.ok(c.cash.ok);
});

test("cash: the count is of all the books together, at the end of Sunday", () => {
  const es = [entry({ type: "income", amount: 500, category_id: "donation" }), entry({ amount: 300, category_id: "gaushala" }), entry({ amount: 50, entry_date: "2026-11-09" })];
  assert.equal(check(es, [], undefined).cash.book, 200);                               // Monday the 9th belongs to the next week
});

test("trial balance: opening balances that do not tally keep the week open", () => {
  const s = setup({ opening: [{ workspace_id: "w", book: "goshala", account: "cash", amount: 1000 }] });
  const c = check([], [], saved({ cash_counted: 1000 }), AFTER, s);
  assert.equal(c.tb.openingDiff, true); assert.equal(c.tb.ok, false); assert.equal(c.ready, false);
});

test("bills: a bill promised but not uploaded keeps the week open; a No-bill self-voucher is allowed", () => {
  const waiting = entry({ bill_path: null, receipt_available: true });
  const self = entry({ bill_path: null, receipt_available: false, no_bill: true });
  let c = check([waiting, self], [], saved({ cash_counted: 0 }));
  assert.equal(c.bills.ok, false); assert.deepEqual(c.bills.waiting.map((e) => e.id), [waiting.id]); assert.equal(c.bills.selfVouchers.length, 1);
  c = check([self], [], saved({ cash_counted: 0 }));
  assert.ok(c.bills.ok);
});

test("entries from before the vouchers began are not in any week's checks", () => {
  const old = entry({ voucher_no: null, payment_mode: "UPI", bill_path: null });
  const c = check([old], [], saved({ cash_counted: 0 }));
  assert.ok(c.bank.ok); assert.ok(c.bills.ok);
});

test("status: a week still running cannot be ready; settled stays settled until something changes", () => {
  const e = entry({ amount: 10 });
  const running = check([e], [], saved({ cash_counted: 0 }), "2026-11-07");
  assert.equal(running.ended, false); assert.equal(statusOf(running), "running");
  assert.equal(check([e], [], saved({ cash_counted: 0 }), "2026-11-08").ended, true);  // Sunday itself counts

  // 10 in hand at the start, 10 spent: the box is empty and the count of 0 agrees.
  const s = setup({ opening: [{ workspace_id: "w", book: "temple", account: "cash", amount: 10 }, { workspace_id: "w", book: "temple", account: "capital_fund", amount: -10 }] });
  const ok = check([e], [], saved({ cash_counted: 0 }), AFTER, s);
  assert.ok(ok.ready);
  const settledRow = saved({ cash_counted: 0, settled_at: "2026-11-09T04:00:00Z", snapshot: { fingerprint: ok.fingerprint } });
  assert.equal(statusOf(check([e], [], settledRow, AFTER, s)), "settled");

  // Editing a voucher of the week after it was settled is pointed out.
  const edited = { ...e, updated_at: "2026-11-15T09:00:00Z" };
  const after = check([edited], [], settledRow, AFTER, s);
  assert.equal(after.changed, true); assert.equal(statusOf(after), "changed");
  // So is a new voucher that breaks a check.
  const broken = check([e, entry({ amount: 5 })], [], settledRow, AFTER, s);
  assert.equal(statusOf(broken), "changed"); assert.equal(broken.cash.ok, false);
});
