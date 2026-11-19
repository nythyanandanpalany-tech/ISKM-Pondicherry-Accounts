// Tests for the books: every figure on every report comes from lib/accounts.ts, so these pin the
// accounting down — that each voucher posts to the right accounts, that every trial balance
// tallies, that an unpaid bill is charged once, and that a new financial year carries forward.
// Run with: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBooks, trialBalance, incomeExpenditure, balanceSheet, receiptsPayments, accountBook, bankBooks, ledgers,
  journalRegister, bankRecon, dayBook, fundWise, billsMissing, unpaidBills, donationsWithoutDonor,
} from "../accounts.ts";
import { weekRange, monthRange, quarterRange, fyRange, shift, fyStart, addDays } from "../periods.ts";

// ---------------------------------------------------------------- fixtures
const cat = (id, name, over = {}) => ({ id, workspace_id: "w", name, kind: "expense", monthly_limit: null, book: "temple", is_capital: false, section: null, ...over });
const CATS = [
  cat("annadanam", "Annadanam"),
  cat("gaushala", "Gaushala", { book: "goshala" }),
  cat("books", "Purchase of books", { book: "books" }),
  cat("build", "Construction – Building", { is_capital: true, section: "construction" }),
  cat("donation", "Donation", { kind: "income" }),
  cat("hundi", "Hundi", { kind: "income" }),
  cat("gdonation", "Goshala donation", { kind: "income", book: "goshala" }),
];
const BANKS = [{ id: "b1", workspace_id: "w", name: "Ujjivan" }, { id: "b2", workspace_id: "w", name: "IDFC" }];
const names = { cat: (id) => CATS.find((c) => c.id === id)?.name ?? "", person: (id) => ({ p1: "Ramesh" })[id] ?? "" };
const setup = (over = {}) => ({ categories: CATS, banks: BANKS, opening: [], vouchersFrom: "2026-11-01", ...over });

let n = 0;
const entry = (over = {}) => {
  n += 1;
  return {
    id: `e${n}`, workspace_id: "w", type: "expense", entry_date: "2026-11-10", amount: 100, category_id: "annadanam", item_id: null,
    person_id: null, payment_mode: "Cash", note: null, reference_no: null, receipt_available: false, bill_path: null,
    payment_proof_path: null, fund_source: null, beneficiary: null, claim_status: null, claim_settled_at: null,
    voucher_type: "CV", voucher_no: `V${n}`, voucher_fy: "2026-2027", voucher_month: 11, voucher_seq: n, no_bill: true,
    jv_kind: null, dr_category_id: null, cr_category_id: null, bank_account_id: null, settles_entry_id: null,
    created_by: "u", created_at: new Date(Date.UTC(2026, 10, 10, 10, 0, 0) + n * 1000).toISOString(), updated_at: "", ...over,
  };
};
const books = (entries, s = setup()) => buildBooks(entries, s, names);
const row = (tb, key) => tb.rows.find((r) => r.key === key);
const close = (tb, key) => { const r = row(tb, key); return r ? r.closeDr - r.closeCr : 0; };

const BASIC = () => [
  entry({ amount: 100, payment_mode: "Cash" }),                                                                              // CV
  entry({ amount: 200, payment_mode: "UPI", bank_account_id: "b1" }),                                                       // BV
  entry({ type: "income", amount: 500, category_id: "donation", payment_mode: "Cash" }),                                    // CR
  entry({ type: "income", amount: 400, category_id: "donation", payment_mode: "Bank Transfer", bank_account_id: "b1" }),   // BR
];

// ---------------------------------------------------------------- posting rules
test("each voucher posts to the right accounts, and the trial balance tallies", () => {
  const tb = trialBalance(books(BASIC()), "all", "2026-11-01", "2026-11-30");
  assert.equal(close(tb, "cash"), 400);                 // +500 -100
  assert.equal(close(tb, "bank:b1"), 200);              // +400 -200
  assert.equal(close(tb, "head:annadanam"), 300);       // expense: debit
  assert.equal(close(tb, "head:donation"), -900);       // income: credit
  assert.equal(tb.balanced, true);
  assert.equal(tb.totals.closeDr, 900);
  assert.equal(tb.totals.closeDr, tb.totals.closeCr);
});

test("an expense with no category still lands somewhere visible", () => {
  const tb = trialBalance(books([entry({ category_id: null, amount: 70 }), entry({ type: "income", category_id: null, amount: 30 })]), "all", "2026-11-01", "2026-11-30");
  assert.equal(close(tb, "head:uncat-exp"), 70);
  assert.equal(close(tb, "head:uncat-inc"), -30);
  assert.equal(tb.balanced, true);
});

test("a bank voucher with no bank chosen is kept apart from the real accounts", () => {
  const tb = trialBalance(books([entry({ payment_mode: "UPI", amount: 90 })]), "all", "2026-11-01", "2026-11-30");
  assert.equal(close(tb, "bank:unassigned"), -90);
  assert.equal(tb.rows.find((r) => r.key === "bank:unassigned").name, "Bank – account not chosen");
});

test("entries from before the module started are not in the books", () => {
  const old = entry({ amount: 999, voucher_no: null, voucher_type: null, entry_date: "2026-10-20" });
  const tb = trialBalance(books([old, ...BASIC()]), "all", "2026-10-01", "2026-11-30");
  assert.equal(tb.totals.dr, 1200);                       // the 999 from October is nowhere in it
  assert.equal(close(tb, "head:annadanam"), 300);
});

// ---------------------------------------------------------------- the three books
test("a head is kept in its own book, and so is the cash it moved", () => {
  const es = [...BASIC(), entry({ category_id: "gaushala", amount: 300, payment_mode: "Cash" }), entry({ category_id: "books", amount: 50, payment_mode: "UPI", bank_account_id: "b2" })];
  const b = books(es);
  const temple = trialBalance(b, "temple", "2026-11-01", "2026-11-30");
  const goshala = trialBalance(b, "goshala", "2026-11-01", "2026-11-30");
  const bk = trialBalance(b, "books", "2026-11-01", "2026-11-30");
  assert.equal(close(goshala, "head:gaushala"), 300);
  assert.equal(close(goshala, "cash"), -300);            // each book is self-contained
  assert.equal(close(bk, "head:books"), 50);
  assert.equal(close(bk, "bank:b2"), -50);
  assert.equal(close(temple, "cash"), 400);              // untouched by the Goshala spend
  for (const tb of [temple, goshala, bk]) assert.equal(tb.balanced, true);
  const all = trialBalance(b, "all", "2026-11-01", "2026-11-30");
  assert.equal(close(all, "cash"), 100);                 // the sum of the books
  assert.equal(all.balanced, true);
});

test("a journal between two books goes through the inter-book account and cancels when combined", () => {
  const jv = entry({ type: "journal", voucher_type: "JV", payment_mode: "Journal", amount: 100, jv_kind: "transfer", dr_category_id: "annadanam", cr_category_id: "gaushala", category_id: null, note: "fix" });
  const b = books([jv]);
  const temple = trialBalance(b, "temple", "2026-11-01", "2026-11-30"), goshala = trialBalance(b, "goshala", "2026-11-01", "2026-11-30");
  assert.equal(close(temple, "head:annadanam"), 100);
  assert.equal(close(temple, "interbook"), -100);        // the Temple book owes the Goshala book
  assert.equal(close(goshala, "interbook"), 100);
  assert.equal(close(goshala, "head:gaushala"), -100);
  assert.equal(temple.balanced && goshala.balanced, true);
  const all = trialBalance(b, "all", "2026-11-01", "2026-11-30");
  assert.equal(all.rows.some((r) => r.key === "interbook"), false);
  assert.equal(all.balanced, true);
  // ...and the balance sheets show who owes whom
  assert.equal(balanceSheet(b, "temple", "2026-11-30").liabilities[0].name, "Due to other books");
  assert.equal(balanceSheet(b, "goshala", "2026-11-30").assets[0].name, "Due from other books");
});

// ---------------------------------------------------------------- accrual: unpaid bills
test("a bill booked by journal is an expense now and a liability until it is paid", () => {
  const jv = entry({ id: "jv", type: "journal", voucher_type: "JV", payment_mode: "Journal", amount: 1000, jv_kind: "unpaid_bill", dr_category_id: "annadanam", category_id: null, note: "Oct bill" });
  const b = books([jv]);
  const ie = incomeExpenditure(b, "all", "2026-11-01", "2026-11-30");
  assert.equal(ie.totals.expense, 1000);                 // accrual: charged before it is paid
  const tb = trialBalance(b, "all", "2026-11-01", "2026-11-30");
  assert.equal(close(tb, "outstanding"), -1000);
  assert.equal(close(tb, "cash"), 0);
  assert.equal(tb.balanced, true);
  assert.equal(unpaidBills(b, "all", "2026-11-30")[0].outstanding, 1000);
});

test("paying that bill clears the liability and does not charge the expense a second time", () => {
  const jv = entry({ id: "jv", type: "journal", voucher_type: "JV", payment_mode: "Journal", amount: 1000, jv_kind: "unpaid_bill", dr_category_id: "annadanam", category_id: null, note: "Oct bill" });
  const pay = entry({ id: "pay", amount: 1000, payment_mode: "UPI", bank_account_id: "b1", category_id: "annadanam", settles_entry_id: "jv", entry_date: "2026-11-20" });
  const b = books([jv, pay]);
  const ie = incomeExpenditure(b, "all", "2026-11-01", "2026-11-30");
  assert.equal(ie.totals.expense, 1000);                 // not 2000
  const tb = trialBalance(b, "all", "2026-11-01", "2026-11-30");
  assert.equal(close(tb, "outstanding"), 0);
  assert.equal(close(tb, "bank:b1"), -1000);
  assert.equal(tb.balanced, true);
  assert.deepEqual(unpaidBills(b, "all", "2026-11-30"), []);
});

test("a part payment leaves the rest outstanding, and ageing counts from the journal", () => {
  const jv = entry({ id: "jv", type: "journal", voucher_type: "JV", payment_mode: "Journal", amount: 1000, jv_kind: "unpaid_bill", dr_category_id: "annadanam", category_id: null, note: "x", entry_date: "2026-11-05" });
  const pay = entry({ amount: 400, settles_entry_id: "jv", entry_date: "2026-11-20" });
  const [u] = unpaidBills(books([jv, pay]), "all", "2026-11-30");
  assert.deepEqual([u.billed, u.paid, u.outstanding, u.days], [1000, 400, 600, 25]);
  // as on a day before the payment, all of it is still owed
  assert.equal(unpaidBills(books([jv, pay]), "all", "2026-11-10")[0].outstanding, 1000);
});

test("a payment that settles a Goshala bill is kept in the Goshala book", () => {
  const jv = entry({ id: "jv", type: "journal", voucher_type: "JV", payment_mode: "Journal", amount: 500, jv_kind: "unpaid_bill", dr_category_id: "gaushala", category_id: null, note: "x" });
  const pay = entry({ amount: 500, payment_mode: "Cash", category_id: "annadanam", settles_entry_id: "jv" });   // the clerk picked a Temple head by mistake
  const b = books([jv, pay]);
  assert.equal(close(trialBalance(b, "goshala", "2026-11-01", "2026-11-30"), "outstanding"), 0);
  assert.equal(trialBalance(b, "temple", "2026-11-01", "2026-11-30").rows.length, 0);
});

// ---------------------------------------------------------------- income & expenditure, capital, construction
test("income and expenditure leaves out capital spending, and keeps Construction in its own section", () => {
  const es = [
    ...BASIC(),
    entry({ category_id: "build", amount: 5000, payment_mode: "UPI", bank_account_id: "b1" }),
  ];
  const ie = incomeExpenditure(books(es), "all", "2026-11-01", "2026-11-30");
  assert.equal(ie.totals.income, 900);
  assert.equal(ie.totals.expense, 300);
  assert.equal(ie.totals.surplus, 600);
  assert.deepEqual(ie.capital.map((r) => [r.name, r.amount]), [["Construction – Building (capital)", 5000]]);
  const bs = balanceSheet(books(es), "all", "2026-11-30");
  const building = bs.assets.find((r) => r.key === "head:build");
  assert.equal(building.amount, 5000);
  assert.equal(building.section, "construction");
  assert.equal(bs.balanced, true);
});

test("a revenue head in the Construction section is reported separately", () => {
  const cats = [...CATS, cat("mat", "Construction expenses", { section: "construction" })];
  const es = [entry({ category_id: "mat", amount: 250 }), entry({ category_id: "annadanam", amount: 100 })];
  const ie = incomeExpenditure(books(es, setup({ categories: cats })), "all", "2026-11-01", "2026-11-30");
  assert.equal(ie.totals.expense, 100);
  assert.equal(ie.totals.constructionExpense, 250);
  assert.equal(ie.totals.surplus, -350);                 // both count towards the result
});

test("income and expenditure covers only the dates asked for", () => {
  const es = [entry({ amount: 100, entry_date: "2026-11-05" }), entry({ amount: 200, entry_date: "2026-11-20" })];
  assert.equal(incomeExpenditure(books(es), "all", "2026-11-01", "2026-11-10").totals.expense, 100);
  assert.equal(incomeExpenditure(books(es), "all", "2026-11-11", "2026-11-30").totals.expense, 200);
});

// ---------------------------------------------------------------- opening balances
const OPEN = [
  { workspace_id: "w", book: "temple", account: "cash", amount: 5000 },
  { workspace_id: "w", book: "temple", account: "bank:b1", amount: 20000 },
  { workspace_id: "w", book: "temple", account: "capital_fund", amount: -25000 },
];

test("opening balances start the balance sheet, and it still balances after the month's activity", () => {
  const b = books(BASIC(), setup({ opening: OPEN }));
  const bs = balanceSheet(b, "all", "2026-11-30");
  assert.equal(bs.assets.find((r) => r.key === "cash").amount, 5400);
  assert.equal(bs.assets.find((r) => r.key === "bank:b1").amount, 20200);
  assert.equal(bs.liabilities.find((r) => r.key === "capital_fund").amount, 25000);
  assert.equal(bs.surplus, 600);
  assert.equal(bs.totalAssets, 25600);
  assert.equal(bs.totalLiabilities, 25600);
  assert.equal(bs.balanced, true);
  const tb = trialBalance(b, "all", "2026-11-01", "2026-11-30");
  assert.equal(row(tb, "cash").openDr, 5000);
  assert.equal(tb.totals.openDr, tb.totals.openCr);
  assert.equal(tb.balanced, true);
});

test("opening balances that do not tally show their gap instead of breaking every report", () => {
  const b = books(BASIC(), setup({ opening: [{ workspace_id: "w", book: "temple", account: "cash", amount: 5000 }] }));
  const tb = trialBalance(b, "all", "2026-11-01", "2026-11-30");
  assert.equal(tb.balanced, true);
  assert.equal(row(tb, "opening_diff").openCr, 5000);
  const bs = balanceSheet(b, "all", "2026-11-30");
  assert.equal(bs.balanced, true);
  assert.ok(bs.liabilities.some((r) => r.key === "opening_diff" && r.amount === 5000));
});

test("April to October figures typed as opening balances count in a full-year report, not a monthly one", () => {
  const open = [
    { workspace_id: "w", book: "temple", account: "head:annadanam", amount: 800 },       // spent April–October
    { workspace_id: "w", book: "temple", account: "head:donation", amount: -1500 },      // received April–October
    { workspace_id: "w", book: "temple", account: "cash", amount: 700 },
  ];
  const b = books([entry({ amount: 100 })], setup({ opening: open }));
  const year = incomeExpenditure(b, "all", "2026-04-01", "2027-03-31");
  assert.equal(year.totals.expense, 900);
  assert.equal(year.totals.income, 1500);
  assert.equal(year.includesOpening, true);
  const month = incomeExpenditure(b, "all", "2026-11-01", "2026-11-30");
  assert.equal(month.totals.expense, 100);
  assert.equal(month.includesOpening, false);
  assert.equal(trialBalance(b, "all", "2026-11-01", "2026-11-30").balanced, true);
});

// ---------------------------------------------------------------- the next financial year
test("a new financial year starts income and expense afresh and carries the surplus into the capital fund", () => {
  const es = [
    entry({ type: "income", category_id: "donation", amount: 1000, payment_mode: "Cash", entry_date: "2027-03-20" }),
    entry({ amount: 300, payment_mode: "Cash", entry_date: "2027-03-25" }),
    entry({ type: "income", category_id: "donation", amount: 50, payment_mode: "Cash", entry_date: "2027-04-02" }),
  ];
  const b = books(es);
  const mar = trialBalance(b, "all", "2027-03-01", "2027-03-31");
  assert.equal(close(mar, "head:donation"), -1000);
  const apr = trialBalance(b, "all", "2027-04-01", "2027-04-30");
  assert.equal(close(apr, "head:donation"), -50);          // only this year's
  assert.equal(close(apr, "head:annadanam"), 0);
  assert.equal(close(apr, "capital_fund"), -700);          // last year's 1000 - 300 carried
  assert.equal(close(apr, "cash"), 750);
  assert.equal(apr.balanced, true);
  const bs = balanceSheet(b, "all", "2027-04-30");
  assert.equal(bs.liabilities.find((r) => r.key === "capital_fund").amount, 700);
  assert.equal(bs.surplus, 50);
  assert.equal(bs.balanced, true);
});

test("a trial balance that starts before its financial year is clipped to the year", () => {
  const tb = trialBalance(books(BASIC()), "all", "2026-01-01", "2026-11-30");
  assert.equal(tb.from, "2026-04-01");
  assert.equal(tb.clipped, true);
});

test("the opening figures of the first year are carried into the capital fund in the second", () => {
  const open = [
    { workspace_id: "w", book: "temple", account: "head:annadanam", amount: 800 },
    { workspace_id: "w", book: "temple", account: "cash", amount: 5000 },
    { workspace_id: "w", book: "temple", account: "capital_fund", amount: -4200 },
  ];
  const b = books([], setup({ opening: open }));
  const bs = balanceSheet(b, "all", "2027-05-31");
  assert.equal(bs.liabilities.find((r) => r.key === "capital_fund").amount, 3400);   // 4200 less the 800 spent
  assert.equal(bs.balanced, true);
});

// ---------------------------------------------------------------- receipts & payments, cash book, bank book
test("receipts and payments run from the opening balance to the closing balance", () => {
  const jv = entry({ id: "jv", type: "journal", voucher_type: "JV", payment_mode: "Journal", amount: 1000, jv_kind: "unpaid_bill", dr_category_id: "annadanam", category_id: null, note: "x", entry_date: "2026-11-03" });
  const es = [...BASIC(), jv, entry({ amount: 1000, payment_mode: "UPI", bank_account_id: "b1", settles_entry_id: "jv", entry_date: "2026-11-25" })];
  const rp = receiptsPayments(books(es, setup({ opening: OPEN })), "all", "2026-11-01", "2026-11-30");
  assert.equal(rp.openingCash, 5000);
  assert.equal(rp.openingBank, 20000);
  assert.deepEqual([rp.totalReceipts.cash, rp.totalReceipts.bank], [500, 400]);
  assert.deepEqual([rp.totalPayments.cash, rp.totalPayments.bank], [100, 1200]);
  assert.equal(rp.closingCash, 5400);
  assert.equal(rp.closingBank, 19200);
  assert.equal(rp.balanced, true);
  assert.ok(rp.payments.some((r) => r.name === "Outstanding expenses settled (bills paid)" && r.bank === 1000));
  assert.ok(!rp.payments.some((r) => r.total === 1000 && r.name === "Annadanam"));   // the journal itself moved no money
});

test("the cash book keeps a running balance", () => {
  const cb = accountBook(books(BASIC(), setup({ opening: OPEN })), "all", "2026-11-01", "2026-11-30", "cash");
  assert.equal(cb.opening, 5000);
  assert.deepEqual(cb.lines.map((l) => l.balance), [4900, 5400]);
  assert.equal(cb.lines[0].payment, 100);
  assert.equal(cb.lines[1].receipt, 500);
  assert.equal(cb.closing, 5400);
  assert.match(cb.lines[1].particulars, /Donation/);
});

test("there is a bank book for each bank account in use, and none for one nothing has gone through", () => {
  const bb = bankBooks(books(BASIC(), setup({ opening: OPEN })), "all", "2026-11-01", "2026-11-30");
  assert.deepEqual(bb.map((x) => x.name), ["Bank – Ujjivan"]);               // IDFC has no opening balance and no vouchers
  const uj = bb.find((x) => x.key === "bank:b1");
  assert.deepEqual([uj.opening, uj.receipts, uj.payments, uj.closing], [20000, 400, 200, 20200]);
});

test("the ledger of an account lists its postings with the other side named", () => {
  const { accounts } = ledgers(books(BASIC()), "all", "2026-11-01", "2026-11-30");
  const ann = accounts.find((a) => a.key === "head:annadanam");
  assert.equal(ann.lines.length, 2);
  assert.equal(ann.lines[0].particulars, "Cash in hand");
  assert.equal(ann.closing, 300);
  assert.equal(accounts.reduce((s, a) => s + a.closing, 0), 0);          // the whole ledger nets to nothing
});

test("the journal register shows both sides of every voucher", () => {
  const reg = journalRegister(books(BASIC()), "all", "2026-11-01", "2026-11-30");
  assert.equal(reg.length, 4);
  for (const v of reg) {
    assert.equal(v.lines.length, 2);
    assert.equal(v.lines.reduce((s, l) => s + l.dr, 0), v.lines.reduce((s, l) => s + l.cr, 0));
  }
});

// ---------------------------------------------------------------- bank reconciliation
test("bank reconciliation lists what is in one list and not the other", () => {
  const a = entry({ id: "a", amount: 200, payment_mode: "UPI", bank_account_id: "b1" });
  const c = entry({ id: "c", amount: 75, payment_mode: "UPI", bank_account_id: "b1" });
  const d = entry({ id: "d", type: "income", category_id: "donation", amount: 300, payment_mode: "Bank Transfer", bank_account_id: "b1" });
  const cash = entry({ id: "cash", amount: 40 });
  const txns = [
    { id: "t1", workspace_id: "w", txn_date: "2026-11-10", description: "UPI/grocer", reference: "111", amount: 200, direction: "debit", matched_entry_id: "a" },
    { id: "t2", workspace_id: "w", txn_date: "2026-11-11", description: "Bank charges", reference: null, amount: 15, direction: "debit", matched_entry_id: null },
  ];
  const r = bankRecon(books([a, c, d, cash]), "all", txns, "2026-11-30");
  assert.equal(r.matched, 1);
  assert.deepEqual(r.inBookNotOnStatement.map((x) => x.voucherNo).length, 2);        // c and d; the cash voucher never touches a bank
  assert.equal(r.bookNet, 225);                                                       // +300 -75
  assert.equal(r.onStatementNotInBook.length, 1);
  assert.equal(r.statementNet, -15);
  assert.equal(r.difference, 240);
  assert.equal(bankRecon(books([a, c, d]), "temple", txns, "2026-11-30").statementShown, false);
});

// ---------------------------------------------------------------- the extra sheets
test("the day book lists the day's vouchers in order, on the right side", () => {
  const es = [entry({ amount: 10, entry_date: "2026-11-02" }), entry({ type: "income", category_id: "donation", amount: 20, entry_date: "2026-11-01" }),
    entry({ type: "journal", voucher_type: "JV", payment_mode: "Journal", amount: 30, jv_kind: "unpaid_bill", dr_category_id: "annadanam", category_id: null, note: "b", entry_date: "2026-11-02" })];
  const rows = dayBook(books(es), "all", "2026-11-01", "2026-11-30");
  assert.deepEqual(rows.map((r) => [r.income, r.expense, r.journal]), [[20, 0, 0], [0, 10, 0], [0, 0, 30]]);
  assert.match(rows[2].particulars, /Dr Annadanam · Cr Outstanding expenses/);
});

test("the fund-wise statement groups by the fund named on each entry", () => {
  const es = [entry({ fund_source: "Annadanam fund", amount: 100 }), entry({ type: "income", category_id: "donation", fund_source: "Annadanam fund", amount: 500 }), entry({ amount: 40 })];
  const f = fundWise(books(es), "all", "2026-11-01", "2026-11-30");
  assert.deepEqual(f.map((r) => [r.fund, r.income, r.expense, r.net]), [["(no fund named)", 0, 40, -40], ["Annadanam fund", 500, 100, 400]]);
});

test("bills missing lists self-vouchers and bills that were promised but never uploaded", () => {
  const es = [
    entry({ id: "self", no_bill: true }),
    entry({ id: "promised", no_bill: false, receipt_available: true, bill_path: null }),
    entry({ id: "ok", no_bill: false, receipt_available: true, bill_path: "x.jpg" }),
    entry({ id: "inc", type: "income", category_id: "donation" }),
  ];
  const m = billsMissing(books(es), "all", "2026-11-01", "2026-11-30");
  assert.deepEqual(m.map((x) => [x.entry.id, x.status]), [["self", "No bill (self-voucher)"], ["promised", "Bill promised, not uploaded"]]);
});

test("donations without a donor leave out hundi, which is anonymous by nature", () => {
  const es = [
    entry({ id: "named", type: "income", category_id: "donation", person_id: "p1" }),
    entry({ id: "anon", type: "income", category_id: "donation", person_id: null }),
    entry({ id: "hundi", type: "income", category_id: "hundi", person_id: null }),
    entry({ id: "exp", type: "expense", person_id: null }),
  ];
  assert.deepEqual(donationsWithoutDonor(books(es), "all", "2026-11-01", "2026-11-30").map((e) => e.id), ["anon"]);
});

test("a book's extra sheets only show that book", () => {
  const es = [entry({ id: "t", no_bill: true }), entry({ id: "g", category_id: "gaushala", no_bill: true })];
  const b = books(es);
  assert.deepEqual(billsMissing(b, "goshala", "2026-11-01", "2026-11-30").map((x) => x.entry.id), ["g"]);
  assert.deepEqual(billsMissing(b, "temple", "2026-11-01", "2026-11-30").map((x) => x.entry.id), ["t"]);
  assert.equal(billsMissing(b, "all", "2026-11-01", "2026-11-30").length, 2);
});

// ---------------------------------------------------------------- periods
test("weeks run Monday to Sunday", () => {
  assert.deepEqual([weekRange("2026-11-19").from, weekRange("2026-11-19").to], ["2026-11-16", "2026-11-22"]);   // a Thursday
  assert.equal(weekRange("2026-11-16").from, "2026-11-16");                                                       // a Monday
  assert.equal(weekRange("2026-11-22").from, "2026-11-16");                                                       // a Sunday
});

test("months and financial-year quarters", () => {
  assert.deepEqual([monthRange("2026-02-10").from, monthRange("2026-02-10").to], ["2026-02-01", "2026-02-28"]);
  assert.equal(monthRange("2028-02-10").to, "2028-02-29");
  assert.deepEqual([quarterRange("2026-11-19").from, quarterRange("2026-11-19").to], ["2026-10-01", "2026-12-31"]);   // Q3
  assert.deepEqual([quarterRange("2027-02-10").from, quarterRange("2027-02-10").to], ["2027-01-01", "2027-03-31"]);   // Q4
  assert.deepEqual([quarterRange("2026-04-01").from, quarterRange("2026-04-01").to], ["2026-04-01", "2026-06-30"]);   // Q1
  assert.match(quarterRange("2026-11-19").label, /^Q3 2026-27/);
  assert.deepEqual([fyRange("2027-02-10").from, fyRange("2027-02-10").to], ["2026-04-01", "2027-03-31"]);
});

test("stepping to the previous and next period", () => {
  const m = monthRange("2026-11-19");
  assert.equal(shift("month", m, -1).from, "2026-10-01");
  assert.equal(shift("month", m, 1).from, "2026-12-01");
  assert.equal(shift("quarter", quarterRange("2026-11-19"), 1).from, "2027-01-01");
  assert.equal(shift("week", weekRange("2026-11-19"), -1).from, "2026-11-09");
  assert.equal(shift("fy", fyRange("2026-11-19"), 1).from, "2027-04-01");
  assert.equal(fyStart("2027-03-31"), "2026-04-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
