/**
 * The reports, as sheets: a title, some columns and some rows. One shape serves the screen, the
 * Excel workbook and the PDF, so a figure can never read differently in the three places.
 *
 * Numbers are left as numbers (Excel gets real numeric cells); zero is shown as blank where a row
 * would otherwise be a column of 0.00. Everything arithmetic lives in lib/accounts.ts.
 */
import {
  accountBook, bankBooks, bankRecon, balanceSheet, billsMissing, dayBook, donationsWithoutDonor, fundWise, incomeExpenditure,
  journalRegister, ledgers, receiptsPayments, trialBalance, unpaidBills, SCOPES, r2,
  type Books, type Group, type Scope,
} from "./accounts";
import { dmy } from "./format";
import { rangeText } from "./periods";
import { VOUCHER_KINDS } from "./voucher";
import type { Txn } from "./types";

export type Cell = string | number | null;
export type SheetRow = { cells: Cell[]; kind?: "head" | "sub" | "total" };
export type Column = { label: string; align?: "left" | "right"; weight?: number };
export type Sheet = { id: string; name: string; title: string; subtitle: string; columns: Column[]; rows: SheetRow[]; notes: string[] };

export type ReportCtx = { b: Books; scope: Scope; from: string; to: string; txns: Txn[] };
export type Report = { id: string; label: string; group: "Books of account" | "Statements" | "Lists"; asOn?: boolean; build: (c: ReportCtx) => Sheet };

const L: Column = { label: "", align: "left" };
const R: Column = { label: "", align: "right" };
const col = (label: string, base: Column = L, weight = 1): Column => ({ ...base, label, weight });
const blank = (n: number) => (Math.abs(n) < 0.005 ? null : r2(n));
const dr = (cells: Cell[]): SheetRow => ({ cells });
const head = (label: string, width: number): SheetRow => ({ cells: [label, ...Array(width - 1).fill(null)], kind: "head" });
const total = (cells: Cell[]): SheetRow => ({ cells, kind: "total" });
const sub = (cells: Cell[]): SheetRow => ({ cells, kind: "sub" });
/** A balance with its side, for the running balance of a ledger. */
const side = (n: number) => (Math.abs(n) < 0.005 ? "0.00" : `${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${n > 0 ? "Dr" : "Cr"}`);
const scopeLabel = (s: Scope) => SCOPES.find((x) => x.id === s)!.label;
const period = (c: ReportCtx) => `${scopeLabel(c.scope)} · ${rangeText(c.from, c.to)}`;
const asOn = (c: ReportCtx) => `${scopeLabel(c.scope)} · as on ${dmy(c.to)}`;
const GROUPS: Record<Group, string> = { asset: "Assets", liability: "Liabilities & capital", income: "Income", expense: "Expenses" };

function sheet(id: string, name: string, title: string, subtitle: string, columns: Column[], rows: SheetRow[], notes: string[] = []): Sheet {
  return { id, name, title, subtitle, columns, rows, notes };
}

// ----------------------------------------------------------------------------- books of account
function trialBalanceSheet(c: ReportCtx): Sheet {
  const tb = trialBalance(c.b, c.scope, c.from, c.to);
  const rows: SheetRow[] = [];
  let g: Group | null = null;
  for (const r of tb.rows) {
    if (r.group !== g) { g = r.group; rows.push(head(GROUPS[g], 7)); }
    rows.push(dr([r.section ? `${r.name} — Construction` : r.name, blank(r.openDr), blank(r.openCr), blank(r.dr), blank(r.cr), blank(r.closeDr), blank(r.closeCr)]));
  }
  const t = tb.totals;
  rows.push(total(["Total", r2(t.openDr), r2(t.openCr), r2(t.dr), r2(t.cr), r2(t.closeDr), r2(t.closeCr)]));
  const notes = [tb.balanced ? "The trial balance tallies: total debits equal total credits." : "THE TRIAL BALANCE DOES NOT TALLY — please report this."];
  if (tb.clipped) notes.push(`A trial balance covers one financial year, so it starts on ${dmy(tb.from)}.`);
  if (tb.rows.some((r) => r.key === "opening_diff")) notes.push("The opening balances entered do not tally; the difference is shown as its own line until they are corrected (Accounts → Setup).");
  return sheet("trial-balance", "Trial Balance", "Trial Balance", `${scopeLabel(c.scope)} · ${rangeText(tb.from, tb.to)} · accrual basis`,
    [col("Account", L, 3), col("Opening Dr", R), col("Opening Cr", R), col("Debit", R), col("Credit", R), col("Closing Dr", R), col("Closing Cr", R)], rows, notes);
}

function ledgersSheet(c: ReportCtx): Sheet {
  const { accounts, from, clipped } = ledgers(c.b, c.scope, c.from, c.to);
  const rows: SheetRow[] = [];
  for (const a of accounts) {
    rows.push(head(a.section ? `${a.name} — Construction` : a.name, 6));
    rows.push(sub([dmy(from), null, "Opening balance", null, null, side(a.opening)]));
    for (const l of a.lines) rows.push(dr([dmy(l.date), l.voucherNo, l.particulars, blank(l.dr), blank(l.cr), side(l.balance)]));
    rows.push(total([null, null, "Closing balance", r2(a.dr), r2(a.cr), side(a.closing)]));
  }
  return sheet("ledgers", "Ledgers", "Ledgers", `${scopeLabel(c.scope)} · ${rangeText(from, c.to)}`,
    [col("Date", L, 0.8), col("Voucher", L, 1.5), col("Particulars", L, 3), col("Debit", R), col("Credit", R), col("Balance", R, 1.2)], rows,
    clipped ? [`Ledgers cover one financial year, so they start on ${dmy(from)}.`] : []);
}

function journalSheet(c: ReportCtx): Sheet {
  const rows: SheetRow[] = [];
  for (const v of journalRegister(c.b, c.scope, c.from, c.to)) {
    const e = v.entry;
    const what = e.voucher_type ? VOUCHER_KINDS[e.voucher_type].label : "";
    v.lines.forEach((l, i) => rows.push(dr([
      i === 0 ? dmy(e.entry_date) : null, i === 0 ? e.voucher_no : null, `${l.dr > 0 ? "Dr" : "   Cr"}  ${l.name}`, blank(l.dr), blank(l.cr),
      i === 0 ? [what, e.note].filter(Boolean).join(" · ") : null,
    ])));
  }
  return sheet("journal", "Journal", "Journal register", period(c), [col("Date", L, 0.8), col("Voucher", L, 1.5), col("Account", L, 2.5), col("Debit", R), col("Credit", R), col("Narration", L, 2.5)], rows);
}

function bookRows(bk: ReturnType<typeof accountBook>, from: string): SheetRow[] {
  const rows: SheetRow[] = [sub([dmy(from), null, "Opening balance", null, null, r2(bk.opening)])];
  for (const l of bk.lines) rows.push(dr([dmy(l.date), l.voucherNo, l.particulars, blank(l.receipt), blank(l.payment), r2(l.balance)]));
  rows.push(total([null, null, "Total / closing balance", r2(bk.receipts), r2(bk.payments), r2(bk.closing)]));
  return rows;
}
const BOOK_COLS = [col("Date", L, 0.8), col("Voucher", L, 1.5), col("Particulars", L, 3), col("Receipts", R), col("Payments", R), col("Balance", R)];

function cashBookSheet(c: ReportCtx): Sheet {
  return sheet("cash-book", "Cash Book", "Cash book", period(c), BOOK_COLS, bookRows(accountBook(c.b, c.scope, c.from, c.to, "cash"), c.from));
}

function bankBookSheet(c: ReportCtx): Sheet {
  const rows: SheetRow[] = [];
  const bbs = bankBooks(c.b, c.scope, c.from, c.to);
  for (const bk of bbs) { rows.push(head(bk.name, 6)); rows.push(...bookRows(bk, c.from)); }
  return sheet("bank-book", "Bank Book", "Bank book", period(c), BOOK_COLS, rows, bbs.length ? [] : ["No bank account has any activity in this period."]);
}

function bankReconSheet(c: ReportCtx): Sheet {
  const r = bankRecon(c.b, c.scope, c.txns, c.to);
  const cols = [col("Date", L, 0.8), col("Voucher", L, 1.5), col("Particulars", L, 3), col("Receipt", R), col("Payment", R)];
  const rows: SheetRow[] = [head("In the bank book, but not on the bank statement", 5)];
  for (const i of r.inBookNotOnStatement) rows.push(dr([dmy(i.date), i.voucherNo, i.particulars, blank(i.receipt), blank(i.payment)]));
  rows.push(total([null, null, "Net (receipts less payments)", null, r.bookNet]));
  if (r.statementShown) {
    rows.push(head("On the bank statement, but not in the bank book", 5));
    for (const i of r.onStatementNotInBook) rows.push(dr([dmy(i.date), null, i.particulars, blank(i.receipt), blank(i.payment)]));
    rows.push(total([null, null, "Net (credits less debits)", null, r.statementNet]));
  }
  rows.push(total([null, null, "Difference still to be explained", null, r.difference]));
  return sheet("bank-recon", "Bank Recon", "Bank reconciliation", asOn(c), cols, rows, [
    `${r.matched} bank voucher(s) are matched to a statement row.`,
    r.statementShown ? "Match the rest in Reconcile; bank charges and interest are entered as vouchers." : "Statement rows are not kept by book, so they are listed only under All books.",
  ]);
}

// ----------------------------------------------------------------------------- statements
function incomeExpenditureSheet(c: ReportCtx): Sheet {
  const ie = incomeExpenditure(c.b, c.scope, c.from, c.to);
  const rows: SheetRow[] = [head("Income", 2), ...ie.income.map((r) => dr([r.name, r.amount])), total(["Total income", ie.totals.income])];
  rows.push(head("Expenditure", 2), ...ie.expense.map((r) => dr([r.name, r.amount])), total(["Total expenditure", ie.totals.expense]));
  rows.push(total([ie.totals.income >= ie.totals.expense ? "Surplus of income over expenditure" : "Deficit — expenditure over income", r2(Math.abs(ie.totals.income - ie.totals.expense))]));
  if (ie.constructionIncome.length || ie.constructionExpense.length) {
    rows.push(head("Construction (a separate section of the Temple book)", 2));
    rows.push(...ie.constructionIncome.map((r) => dr([`${r.name} (income)`, r.amount])), ...ie.constructionExpense.map((r) => dr([`${r.name} (expense)`, r.amount])));
    rows.push(total(["Construction: net", r2(ie.totals.constructionIncome - ie.totals.constructionExpense)]));
    rows.push(total([ie.totals.surplus >= 0 ? "Surplus including Construction" : "Deficit including Construction", r2(Math.abs(ie.totals.surplus))]));
  }
  if (ie.capital.length) {
    rows.push(head("Capital expenditure (an asset — not charged to expenditure)", 2), ...ie.capital.map((r) => dr([r.name, r.amount])), total(["Total capital expenditure", ie.totals.capital]));
  }
  return sheet("income-expenditure", "Income & Expenditure", "Income & Expenditure account", `${period(c)} · accrual basis`, [col("Particulars", L, 4), col("Amount", R)], rows,
    ie.includesOpening ? ["Includes the April–October figures entered as opening balances."] : []);
}

function balanceSheetSheet(c: ReportCtx): Sheet {
  const bs = balanceSheet(c.b, c.scope, c.to);
  const rows: SheetRow[] = [head("Liabilities & capital", 2)];
  for (const r of bs.liabilities) rows.push(dr([r.name, r.amount]));
  rows.push(dr([bs.surplus >= 0 ? "Surplus for the year so far" : "Deficit for the year so far", bs.surplus]));
  rows.push(total(["Total liabilities & capital", bs.totalLiabilities]));
  rows.push(head("Assets", 2));
  for (const r of bs.assets.filter((x) => !x.capital)) rows.push(dr([r.name, r.amount]));
  const cap = bs.assets.filter((x) => x.capital);
  if (cap.length) { rows.push(sub(["Capital assets (cost; no depreciation)", null])); for (const r of cap) rows.push(dr([r.section ? `${r.name} — Construction` : r.name, r.amount])); }
  rows.push(total(["Total assets", bs.totalAssets]));
  return sheet("balance-sheet", "Balance Sheet", "Balance sheet", asOn(c), [col("Particulars", L, 4), col("Amount", R)], rows, [
    bs.balanced ? "The balance sheet balances." : "THE BALANCE SHEET DOES NOT BALANCE — please report this.",
    "Capital assets are carried at cost: no depreciation and no asset register for now.",
  ]);
}

function receiptsPaymentsSheet(c: ReportCtx): Sheet {
  const rp = receiptsPayments(c.b, c.scope, c.from, c.to);
  const rows: SheetRow[] = [head("Receipts", 4)];
  rows.push(dr(["Opening balance", blank(rp.openingCash), blank(rp.openingBank), r2(rp.openingCash + rp.openingBank)]));
  for (const r of rp.receipts) rows.push(dr([r.name, blank(r.cash), blank(r.bank), r.total]));
  rows.push(total(["Total receipts", r2(rp.openingCash + rp.totalReceipts.cash), r2(rp.openingBank + rp.totalReceipts.bank), r2(rp.openingCash + rp.openingBank + rp.totalReceipts.total)]));
  rows.push(head("Payments", 4));
  for (const r of rp.payments) rows.push(dr([r.name, blank(r.cash), blank(r.bank), r.total]));
  rows.push(dr(["Closing balance", rp.closingCash, rp.closingBank, r2(rp.closingCash + rp.closingBank)]));
  rows.push(total(["Total payments", r2(rp.totalPayments.cash + rp.closingCash), r2(rp.totalPayments.bank + rp.closingBank), r2(rp.totalPayments.total + rp.closingCash + rp.closingBank)]));
  return sheet("receipts-payments", "Receipts & Payments", "Receipts & Payments account", period(c), [col("Particulars", L, 4), col("Cash", R), col("Bank", R), col("Total", R)], rows, [
    rp.balanced ? "Opening balance plus receipts less payments equals the closing balance." : "THE CASH AND BANK FIGURES DO NOT RECONCILE — please report this.",
    "Cash basis: only money that actually moved. Journal vouchers do not appear here.",
  ]);
}

// ----------------------------------------------------------------------------- lists
function dayBookSheet(c: ReportCtx): Sheet {
  const d = dayBook(c.b, c.scope, c.from, c.to);
  const sum = (f: (r: (typeof d)[number]) => number) => r2(d.reduce((s, r) => s + f(r), 0));
  const rows = d.map((r) => dr([dmy(r.entry.entry_date), r.entry.voucher_no, r.particulars, blank(r.income), blank(r.expense), blank(r.journal)]));
  rows.push(total([null, null, "Total", sum((r) => r.income), sum((r) => r.expense), sum((r) => r.journal)]));
  return sheet("day-book", "Day Book", "Day book", period(c), [col("Date", L, 0.8), col("Voucher", L, 1.5), col("Particulars", L, 3), col("Income", R), col("Expense", R), col("Journal", R)], rows);
}

function fundWiseSheet(c: ReportCtx): Sheet {
  const f = fundWise(c.b, c.scope, c.from, c.to);
  const sum = (k: "income" | "expense" | "net") => r2(f.reduce((s, r) => s + r[k], 0));
  const rows = f.map((r) => dr([r.fund, blank(r.income), blank(r.expense), r.net]));
  rows.push(total(["Total", sum("income"), sum("expense"), sum("net")]));
  return sheet("fund-wise", "Fund-wise", "Fund-wise statement", period(c), [col("Fund", L, 3), col("Income", R), col("Expense", R), col("Net", R)], rows,
    ["Money received and paid, grouped by the “Fund source” typed on each entry (cash basis: capital spending and payments of bills already booked are included; journals, which move no money, are not).", "Named funds (FCRA, CSR, Building…) will replace this once the seva tier list is approved."]);
}

function billsMissingSheet(c: ReportCtx): Sheet {
  const m = billsMissing(c.b, c.scope, c.from, c.to);
  const rows = m.map(({ entry: e, status }) => dr([dmy(e.entry_date), e.voucher_no, c.b.names.cat(e.category_id) || "—", c.b.names.person(e.person_id), e.payment_mode, e.amount, status]));
  rows.push(total([null, null, "Total", null, null, r2(m.reduce((s, x) => s + x.entry.amount, 0)), `${m.length} entr${m.length === 1 ? "y" : "ies"}`]));
  return sheet("bills-missing", "Bills Missing", "Bills-missing list", period(c),
    [col("Date", L, 0.8), col("Voucher", L, 1.5), col("Head", L, 1.5), col("Paid by", L, 1.2), col("Mode", L, 0.9), col("Amount", R), col("Status", L, 1.8)], rows);
}

function unpaidBillsSheet(c: ReportCtx): Sheet {
  const u = unpaidBills(c.b, c.scope, c.to);
  const sum = (k: "billed" | "paid" | "outstanding") => r2(u.reduce((s, r) => s + r[k], 0));
  const rows = u.map((r) => dr([dmy(r.entry.entry_date), r.entry.voucher_no, c.b.names.cat(r.entry.dr_category_id) || "—", r.entry.note, r.billed, blank(r.paid), r.outstanding, r.days]));
  rows.push(total([null, null, "Total", null, sum("billed"), blank(sum("paid")), sum("outstanding"), null]));
  return sheet("unpaid-bills", "Unpaid Bills", "Unpaid bills list", asOn(c),
    [col("Booked on", L, 0.9), col("Journal", L, 1.5), col("Head", L, 1.4), col("Narration", L, 2.2), col("Billed", R), col("Paid", R), col("Outstanding", R), col("Days", R, 0.6)], rows);
}

function donationsSheet(c: ReportCtx): Sheet {
  const d = donationsWithoutDonor(c.b, c.scope, c.from, c.to);
  const rows = d.map((e) => dr([dmy(e.entry_date), e.voucher_no, c.b.names.cat(e.category_id) || "—", e.payment_mode, e.reference_no, e.amount]));
  rows.push(total([null, null, "Total", null, `${d.length} receipt${d.length === 1 ? "" : "s"}`, r2(d.reduce((s, e) => s + e.amount, 0))]));
  return sheet("donations-no-donor", "No Donor", "Donations without donor name", period(c),
    [col("Date", L, 0.8), col("Voucher", L, 1.5), col("Head", L, 1.8), col("Mode", L, 1), col("Reference", L, 1.4), col("Amount", R)], rows,
    ["Income received with no donor named. Hundi collections are anonymous by nature and are not listed."]);
}

// ----------------------------------------------------------------------------- the catalogue
export const REPORTS: Report[] = [
  { id: "trial-balance", label: "Trial balance", group: "Books of account", build: trialBalanceSheet },
  { id: "ledgers", label: "Ledgers", group: "Books of account", build: ledgersSheet },
  { id: "journal", label: "Journal register", group: "Books of account", build: journalSheet },
  { id: "cash-book", label: "Cash book", group: "Books of account", build: cashBookSheet },
  { id: "bank-book", label: "Bank book", group: "Books of account", build: bankBookSheet },
  { id: "bank-recon", label: "Bank reconciliation", group: "Books of account", asOn: true, build: bankReconSheet },
  { id: "income-expenditure", label: "Income & Expenditure", group: "Statements", build: incomeExpenditureSheet },
  { id: "balance-sheet", label: "Balance sheet", group: "Statements", asOn: true, build: balanceSheetSheet },
  { id: "receipts-payments", label: "Receipts & Payments", group: "Statements", build: receiptsPaymentsSheet },
  { id: "day-book", label: "Day book", group: "Lists", build: dayBookSheet },
  { id: "fund-wise", label: "Fund-wise statement", group: "Lists", build: fundWiseSheet },
  { id: "bills-missing", label: "Bills-missing list", group: "Lists", build: billsMissingSheet },
  { id: "unpaid-bills", label: "Unpaid bills list", group: "Lists", asOn: true, build: unpaidBillsSheet },
  { id: "donations-no-donor", label: "Donations without donor name", group: "Lists", build: donationsSheet },
];

export const reportById = (id: string) => REPORTS.find((r) => r.id === id) ?? REPORTS[0];

/** The auditor pack: every report above, for one book (or all) and one period. */
export const auditorPack = (c: ReportCtx): Sheet[] => REPORTS.map((r) => r.build(c));
