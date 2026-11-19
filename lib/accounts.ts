/**
 * The books, built from the numbered vouchers.
 *
 * Every voucher posts as double entry, so Journal -> Ledger -> Trial Balance fall out of one list of
 * postings (accrual basis, financial year April–March):
 *
 *   CV  expense, cash        Dr the head              Cr Cash in hand
 *   BV  expense, bank        Dr the head              Cr Bank (the account chosen on the voucher)
 *   CR  income, cash         Dr Cash in hand          Cr the head
 *   BR  income, bank         Dr Bank                  Cr the head
 *   JV  journal              Dr one head              Cr another head, or Outstanding expenses
 *                                                      for a bill not yet paid
 *   a payment that settles an unpaid-bill journal:
 *                            Dr Outstanding expenses  Cr Cash / Bank        (not the head again)
 *
 * There are three separate books — Temple, Goshala, Books — and a head belongs to exactly one (set in
 * Accounts -> Setup). A voucher is kept in the book of its head, and so are the cash and bank legs:
 * each book is self-contained and its trial balance tallies on its own. "All books" is simply their
 * sum. A journal that moves an amount from a head in one book to a head in another is posted through
 * an inter-book account on each side, which cancels in the combined view.
 *
 * This file is pure — no React, no database — so every figure on every report is covered by
 * lib/tests/accounts.test.mjs. Screens fetch the rows; lib/sheets.ts lays the results out.
 */
import type { BankAccount, Book, Category, Entry, OpeningBalance, Txn } from "./types";
import { addDays, fyStart } from "./periods";

export type Scope = Book | "all";
export const BOOK_ORDER: Book[] = ["temple", "goshala", "books"];
export const BOOKS: Record<Book, { label: string }> = { temple: { label: "Temple" }, goshala: { label: "Goshala" }, books: { label: "Books" } };
export const SCOPES: { id: Scope; label: string }[] = [{ id: "all", label: "All books" }, ...BOOK_ORDER.map((id) => ({ id, label: BOOKS[id].label }))];

export type Names = { cat: (id: string | null) => string; person: (id: string | null) => string };
export type Setup = { categories: Category[]; banks: BankAccount[]; opening: OpeningBalance[]; vouchersFrom: string | null };

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const zero = (n: number) => Math.abs(n) < 0.005;
export const isCash = (mode: string) => mode.trim().toLowerCase() === "cash";
export const isBankAccount = (key: string) => key.startsWith("bank:");
export const isCashOrBank = (key: string) => key === "cash" || isBankAccount(key);

// ----------------------------------------------------------------------------- accounts
export type Group = "asset" | "liability" | "income" | "expense";
export type AccountMeta = { key: string; name: string; group: Group; section: "construction" | null; capital: boolean };

/** The standing accounts every book has. Heads and bank accounts are added from the setup. */
export const STANDING: { key: string; name: string; group: Group }[] = [
  { key: "cash", name: "Cash in hand", group: "asset" },
  { key: "loans_advances", name: "Loans & advances", group: "asset" },
  { key: "bbt_recoverable", name: "Recoverable from BBT trade book", group: "asset" },
  { key: "capital_fund", name: "Capital fund", group: "liability" },
  { key: "outstanding", name: "Outstanding expenses (bills not yet paid)", group: "liability" },
  { key: "loans_received", name: "Loans received", group: "liability" },
];

export type Posting = { entry: Entry; book: Book; account: string; dr: number; cr: number };

export type Books = {
  setup: Setup; names: Names; entries: Entry[];
  postings: Posting[];
  catById: Map<string, Category>; entryById: Map<string, Entry>;
  meta: (key: string) => AccountMeta;
  /** Postings of one voucher in one book, for naming the other side of a line. */
  groups: Map<string, Posting[]>;
  /** The books each voucher touches (a journal across books touches two). */
  booksOf: Map<string, Set<Book>>;
  opening: Map<Book, Map<string, number>>;
};

export function buildBooks(entries: Entry[], setup: Setup, names: Names): Books {
  const catById = new Map(setup.categories.map((c) => [c.id, c]));
  const bankById = new Map(setup.banks.map((b) => [b.id, b]));
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const bookOf = (catId: string | null): Book => (catId ? catById.get(catId)?.book : undefined) ?? "temple";

  const meta = (key: string): AccountMeta => {
    const standing = STANDING.find((s) => s.key === key);
    if (standing) return { ...standing, section: null, capital: false };
    if (key === "interbook") return { key, name: "Inter-book account", group: "asset", section: null, capital: false };
    if (key === "opening_diff") return { key, name: "Opening balance difference (to be resolved)", group: "liability", section: null, capital: false };
    if (key === "bank:unassigned") return { key, name: "Bank – account not chosen", group: "asset", section: null, capital: false };
    if (key.startsWith("bank:")) return { key, name: `Bank – ${bankById.get(key.slice(5))?.name ?? "removed account"}`, group: "asset", section: null, capital: false };
    if (key === "head:uncat-exp") return { key, name: "Uncategorised expenses", group: "expense", section: null, capital: false };
    if (key === "head:uncat-inc") return { key, name: "Uncategorised income", group: "income", section: null, capital: false };
    const c = catById.get(key.slice(5));
    if (!c) return { key, name: "Removed head", group: "expense", section: null, capital: false };
    const capital = c.kind === "expense" && c.is_capital;
    return { key, name: capital ? `${c.name} (capital)` : c.name, group: capital ? "asset" : c.kind === "income" ? "income" : "expense", section: c.section, capital };
  };

  const head = (catId: string | null, type: "expense" | "income") => (catId ? `head:${catId}` : type === "income" ? "head:uncat-inc" : "head:uncat-exp");
  const cashLeg = (e: Entry) => (isCash(e.payment_mode) ? "cash" : `bank:${e.bank_account_id ?? "unassigned"}`);

  function post(e: Entry): Posting[] {
    const amt = e.amount, line = (book: Book, account: string, dr: number, cr: number): Posting => ({ entry: e, book, account, dr, cr });
    if (e.type === "journal") {
      const drBook = bookOf(e.dr_category_id), drAcc = head(e.dr_category_id, "expense");
      if (e.jv_kind === "unpaid_bill") return [line(drBook, drAcc, amt, 0), line(drBook, "outstanding", 0, amt)];
      const crBook = bookOf(e.cr_category_id), crAcc = head(e.cr_category_id, "income");
      if (drBook === crBook) return [line(drBook, drAcc, amt, 0), line(drBook, crAcc, 0, amt)];
      // Across two books each side is posted in its own book, through the inter-book account.
      return [line(drBook, drAcc, amt, 0), line(drBook, "interbook", 0, amt), line(crBook, "interbook", amt, 0), line(crBook, crAcc, 0, amt)];
    }
    if (e.type === "expense") {
      const settled = e.settles_entry_id ? entryById.get(e.settles_entry_id) : undefined;
      const book = settled ? bookOf(settled.dr_category_id) : bookOf(e.category_id);
      return [line(book, settled ? "outstanding" : head(e.category_id, "expense"), amt, 0), line(book, cashLeg(e), 0, amt)];
    }
    const book = bookOf(e.category_id);
    return [line(book, cashLeg(e), amt, 0), line(book, head(e.category_id, "income"), 0, amt)];
  }

  const ordered = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const postings: Posting[] = [];
  const groups = new Map<string, Posting[]>();
  const booksOf = new Map<string, Set<Book>>();
  for (const e of ordered) {
    // Only vouchers are in the books. Entries from before 1 November 2026 have no voucher number.
    if (!e.voucher_no) { booksOf.set(e.id, new Set([bookOf(e.type === "journal" ? e.dr_category_id : e.category_id)])); continue; }
    for (const p of post(e)) {
      postings.push(p);
      const k = `${e.id}|${p.book}`;
      groups.set(k, [...(groups.get(k) ?? []), p]);
      booksOf.set(e.id, (booksOf.get(e.id) ?? new Set()).add(p.book));
    }
  }

  const opening = new Map<Book, Map<string, number>>();
  for (const o of setup.opening) {
    if (!opening.has(o.book)) opening.set(o.book, new Map());
    opening.get(o.book)!.set(o.account, (opening.get(o.book)!.get(o.account) ?? 0) + Number(o.amount));
  }
  return { setup, names, entries, postings, catById, entryById, meta, groups, booksOf, opening };
}

const inScope = (book: Book, scope: Scope) => scope === "all" || book === scope;
const entryInScope = (b: Books, e: Entry, scope: Scope) => scope === "all" || !!b.booksOf.get(e.id)?.has(scope);
/** The inter-book account only exists to balance each book on its own; together the books owe nothing, so it is not shown. */
const hidden = (scope: Scope, account: string) => scope === "all" && account === "interbook";
const isIE = (m: AccountMeta) => m.group === "income" || m.group === "expense";

function openingTotal(b: Books, scope: Scope): Map<string, number> {
  const out = new Map<string, number>();
  for (const [book, rows] of b.opening) {
    if (!inScope(book, scope)) continue;
    for (const [k, v] of rows) out.set(k, (out.get(k) ?? 0) + v);
  }
  return out;
}

// ----------------------------------------------------------------------------- balances
/**
 * Where every account stands at the start of the day `before`, for a report in the financial year
 * that began on `fy`. Signed: debit positive, credit negative.
 *
 *  - Balance-sheet accounts run on from the opening balances through every voucher.
 *  - Income and expense heads count only the current financial year, plus their opening figure in
 *    the first year (April to October's totals, for the year the system began in the middle of).
 *  - What the income and expense heads left behind in earlier years moves into the capital fund.
 *  - If the opening balances do not tally, the gap shows as its own line instead of unbalancing
 *    every report.
 */
export function balances(b: Books, scope: Scope, before: string, fy: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string, v: number) => out.set(k, (out.get(k) ?? 0) + v);
  const first = b.setup.vouchersFrom ? fyStart(b.setup.vouchersFrom) : null;
  const open = openingTotal(b, scope);
  let carry = 0, openSum = 0;
  for (const [k, v] of open) {
    openSum += v;
    if (!isIE(b.meta(k))) add(k, v);
    else if (fy === first) add(k, v);
    else if (first && fy > first) carry += v;
  }
  for (const p of b.postings) {
    if (!inScope(p.book, scope) || p.entry.entry_date >= before) continue;
    const v = p.dr - p.cr;
    if (!isIE(b.meta(p.account))) add(p.account, v);
    else if (p.entry.entry_date >= fy) add(p.account, v);
    else carry += v;
  }
  if (!zero(carry)) add("capital_fund", carry);
  if (!zero(openSum)) add("opening_diff", -openSum);
  for (const [k, v] of out) out.set(k, r2(v));
  return out;
}

const GROUP_ORDER: Record<Group, number> = { asset: 0, liability: 1, income: 2, expense: 3 };
function sortKey(b: Books, key: string): [number, number, string] {
  const m = b.meta(key);
  const sub = key === "cash" ? 0 : isBankAccount(key) ? 1 : m.capital ? 3 : 2;
  return [GROUP_ORDER[m.group], sub, m.name.toLowerCase()];
}
function byAccount(b: Books) {
  return (x: string, y: string) => {
    const a = sortKey(b, x), c = sortKey(b, y);
    return a[0] - c[0] || a[1] - c[1] || a[2].localeCompare(c[2]);
  };
}

// ----------------------------------------------------------------------------- trial balance
export type TbRow = {
  key: string; name: string; group: Group; section: "construction" | null;
  openDr: number; openCr: number; dr: number; cr: number; closeDr: number; closeCr: number;
};
export type TrialBalance = {
  rows: TbRow[]; from: string; to: string; clipped: boolean;
  totals: { openDr: number; openCr: number; dr: number; cr: number; closeDr: number; closeCr: number };
  balanced: boolean;
};

/**
 * Trial balance for [from, to]. A trial balance belongs to one financial year, so a range that
 * reaches back before the year in which `to` falls starts at the beginning of that year instead.
 */
export function trialBalance(b: Books, scope: Scope, from: string, to: string): TrialBalance {
  const fy = fyStart(to);
  const f = from < fy ? fy : from;
  const open = balances(b, scope, f, fy);
  const move = new Map<string, { dr: number; cr: number }>();
  for (const p of b.postings) {
    if (!inScope(p.book, scope) || p.entry.entry_date < f || p.entry.entry_date > to || hidden(scope, p.account)) continue;
    const m = move.get(p.account) ?? { dr: 0, cr: 0 };
    m.dr += p.dr; m.cr += p.cr; move.set(p.account, m);
  }
  const keys = [...new Set([...open.keys(), ...move.keys()])].sort(byAccount(b));
  const rows: TbRow[] = [];
  for (const key of keys) {
    const o = open.get(key) ?? 0, m = move.get(key) ?? { dr: 0, cr: 0 };
    const c = r2(o + m.dr - m.cr);
    if (zero(o) && zero(m.dr) && zero(m.cr) && zero(c)) continue;
    const meta = b.meta(key);
    rows.push({
      key, name: meta.name, group: meta.group, section: meta.section,
      openDr: o > 0 ? o : 0, openCr: o < 0 ? -o : 0, dr: r2(m.dr), cr: r2(m.cr), closeDr: c > 0 ? c : 0, closeCr: c < 0 ? -c : 0,
    });
  }
  const sum = (f2: (r: TbRow) => number) => r2(rows.reduce((s, r) => s + f2(r), 0));
  const totals = { openDr: sum((r) => r.openDr), openCr: sum((r) => r.openCr), dr: sum((r) => r.dr), cr: sum((r) => r.cr), closeDr: sum((r) => r.closeDr), closeCr: sum((r) => r.closeCr) };
  const balanced = zero(totals.openDr - totals.openCr) && zero(totals.dr - totals.cr) && zero(totals.closeDr - totals.closeCr);
  return { rows, from: f, to, clipped: f !== from, totals, balanced };
}

// ----------------------------------------------------------------------------- income & expenditure
export type IeRow = { key: string; name: string; amount: number };
export type IncomeExpenditure = {
  income: IeRow[]; expense: IeRow[];
  constructionIncome: IeRow[]; constructionExpense: IeRow[];
  /** Capital spending in the period: not an expense, shown for completeness. */
  capital: IeRow[];
  totals: { income: number; expense: number; constructionIncome: number; constructionExpense: number; capital: number; surplus: number };
  /** True when the April–October opening figures are included (the report covers the whole first year). */
  includesOpening: boolean;
};

export function incomeExpenditure(b: Books, scope: Scope, from: string, to: string): IncomeExpenditure {
  const vf = b.setup.vouchersFrom;
  const includesOpening = !!vf && from <= fyStart(vf) && to >= vf;
  const sums = new Map<string, number>();
  const add = (k: string, v: number) => sums.set(k, (sums.get(k) ?? 0) + v);
  if (includesOpening) for (const [k, v] of openingTotal(b, scope)) if (isIE(b.meta(k))) add(k, v);
  const cap = new Map<string, number>();
  for (const p of b.postings) {
    if (!inScope(p.book, scope) || p.entry.entry_date < from || p.entry.entry_date > to) continue;
    const m = b.meta(p.account);
    if (isIE(m)) add(p.account, p.dr - p.cr);
    else if (m.capital) cap.set(p.account, (cap.get(p.account) ?? 0) + p.dr - p.cr);
  }
  const rowsOf = (group: Group, section: "construction" | null): IeRow[] =>
    [...sums.entries()].map(([key, v]) => ({ m: b.meta(key), v })).filter(({ m, v }) => m.group === group && m.section === section && !zero(v))
      .map(({ m, v }) => ({ key: m.key, name: m.name, amount: r2(group === "income" ? -v : v) })).sort((x, y) => x.name.localeCompare(y.name));
  const income = rowsOf("income", null), expense = rowsOf("expense", null);
  const constructionIncome = rowsOf("income", "construction"), constructionExpense = rowsOf("expense", "construction");
  const capital = [...cap.entries()].filter(([, v]) => !zero(v)).map(([key, v]) => ({ key, name: b.meta(key).name, amount: r2(v) })).sort((x, y) => x.name.localeCompare(y.name));
  const t = (rows: IeRow[]) => r2(rows.reduce((s, r) => s + r.amount, 0));
  const totals = { income: t(income), expense: t(expense), constructionIncome: t(constructionIncome), constructionExpense: t(constructionExpense), capital: t(capital), surplus: 0 };
  totals.surplus = r2(totals.income - totals.expense + totals.constructionIncome - totals.constructionExpense);
  return { income, expense, constructionIncome, constructionExpense, capital, totals, includesOpening };
}

// ----------------------------------------------------------------------------- balance sheet
export type BsRow = { key: string; name: string; amount: number; capital: boolean; section: "construction" | null };
export type BalanceSheet = {
  assets: BsRow[]; liabilities: BsRow[];
  /** Income less expenditure so far this financial year; part of the capital on the liabilities side. */
  surplus: number;
  totalAssets: number; totalLiabilities: number; balanced: boolean; asOf: string;
};

export function balanceSheet(b: Books, scope: Scope, asOf: string): BalanceSheet {
  const bal = balances(b, scope, addDays(asOf, 1), fyStart(asOf));
  const assets: BsRow[] = [], liabilities: BsRow[] = [];
  let ie = 0;
  for (const key of [...bal.keys()].sort(byAccount(b))) {
    const v = bal.get(key)!, m = b.meta(key);
    if (zero(v)) continue;
    if (isIE(m)) { ie += v; continue; }
    // Only the inter-book account moves sides, according to whether the books owe or are owed.
    // An overdrawn cash or bank account stays among the assets, as a negative figure.
    if (key === "interbook") {
      if (v >= 0) assets.push({ key, name: "Due from other books", amount: v, capital: false, section: null });
      else liabilities.push({ key, name: "Due to other books", amount: -v, capital: false, section: null });
    } else if (m.group === "asset") assets.push({ key, name: m.name, amount: v, capital: m.capital, section: m.section });
    else liabilities.push({ key, name: m.name, amount: -v, capital: false, section: null });
  }
  const surplus = r2(-ie);
  const totalAssets = r2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = r2(liabilities.reduce((s, r) => s + r.amount, 0) + surplus);
  return { assets, liabilities, surplus, totalAssets, totalLiabilities, balanced: zero(totalAssets - totalLiabilities), asOf };
}

// ----------------------------------------------------------------------------- books of account
/** What a line is for, in a clerk's words: the other side, who, and the note. */
function particulars(b: Books, p: Posting): string {
  const others = (b.groups.get(`${p.entry.id}|${p.book}`) ?? []).filter((q) => q !== p && q.account !== p.account).map((q) => b.meta(q.account).name);
  const who = p.entry.type === "journal" ? "" : b.names.person(p.entry.person_id);
  return [[...new Set(others)].join(", "), who, p.entry.note].filter(Boolean).join(" · ");
}

export type BookLine = { date: string; voucherNo: string; particulars: string; receipt: number; payment: number; balance: number };
export type AccountBook = { key: string; name: string; opening: number; lines: BookLine[]; receipts: number; payments: number; closing: number };

/** Cash book or one bank's book: receipts on the debit side, payments on the credit side, running balance. */
export function accountBook(b: Books, scope: Scope, from: string, to: string, account: string): AccountBook {
  let bal = balances(b, scope, from, fyStart(to)).get(account) ?? 0;
  const opening = r2(bal);
  const lines: BookLine[] = [];
  for (const p of b.postings) {
    if (!inScope(p.book, scope) || p.account !== account || p.entry.entry_date < from || p.entry.entry_date > to) continue;
    bal = r2(bal + p.dr - p.cr);
    lines.push({ date: p.entry.entry_date, voucherNo: p.entry.voucher_no ?? "", particulars: particulars(b, p), receipt: p.dr, payment: p.cr, balance: bal });
  }
  return { key: account, name: b.meta(account).name, opening, lines, receipts: r2(lines.reduce((s, l) => s + l.receipt, 0)), payments: r2(lines.reduce((s, l) => s + l.payment, 0)), closing: r2(bal) };
}

/** One book per bank account: every account set up, plus "not chosen" if any voucher left it blank. */
export function bankBooks(b: Books, scope: Scope, from: string, to: string): AccountBook[] {
  const keys = new Set(b.setup.banks.map((x) => `bank:${x.id}`));
  for (const p of b.postings) if (isBankAccount(p.account) && inScope(p.book, scope)) keys.add(p.account);
  for (const book of BOOK_ORDER) if (inScope(book, scope)) for (const k of b.opening.get(book)?.keys() ?? []) if (isBankAccount(k)) keys.add(k);
  return [...keys].sort(byAccount(b)).map((k) => accountBook(b, scope, from, to, k)).filter((x) => x.lines.length || !zero(x.opening) || !zero(x.closing));
}

export type LedgerAccount = { key: string; name: string; group: Group; section: "construction" | null; opening: number; lines: { date: string; voucherNo: string; particulars: string; dr: number; cr: number; balance: number }[]; dr: number; cr: number; closing: number };

/** Every account with its postings in the period and a running balance (a negative balance is a credit). */
export function ledgers(b: Books, scope: Scope, from: string, to: string): { accounts: LedgerAccount[]; from: string; clipped: boolean } {
  const fy = fyStart(to), f = from < fy ? fy : from;
  const open = balances(b, scope, f, fy);
  const lines = new Map<string, Posting[]>();
  for (const p of b.postings) {
    if (!inScope(p.book, scope) || p.entry.entry_date < f || p.entry.entry_date > to || hidden(scope, p.account)) continue;
    lines.set(p.account, [...(lines.get(p.account) ?? []), p]);
  }
  const keys = [...new Set([...open.keys(), ...lines.keys()])].sort(byAccount(b));
  const accounts: LedgerAccount[] = [];
  for (const key of keys) {
    const ps = lines.get(key) ?? [], o = open.get(key) ?? 0;
    if (!ps.length && zero(o)) continue;
    let bal = o;
    const ls = ps.map((p) => { bal = r2(bal + p.dr - p.cr); return { date: p.entry.entry_date, voucherNo: p.entry.voucher_no ?? "", particulars: particulars(b, p), dr: p.dr, cr: p.cr, balance: bal }; });
    const m = b.meta(key);
    accounts.push({ key, name: m.name, group: m.group, section: m.section, opening: r2(o), lines: ls, dr: r2(ps.reduce((s, p) => s + p.dr, 0)), cr: r2(ps.reduce((s, p) => s + p.cr, 0)), closing: r2(bal) });
  }
  return { accounts, from: f, clipped: f !== from };
}

export type JournalVoucher = { entry: Entry; lines: { book: Book; account: string; name: string; dr: number; cr: number }[] };
/** Every voucher in the period with the debit and credit lines it posts, oldest first. */
export function journalRegister(b: Books, scope: Scope, from: string, to: string): JournalVoucher[] {
  const out = new Map<string, JournalVoucher>();
  for (const p of b.postings) {
    if (!inScope(p.book, scope) || p.entry.entry_date < from || p.entry.entry_date > to) continue;
    const v = out.get(p.entry.id) ?? { entry: p.entry, lines: [] };
    v.lines.push({ book: p.book, account: p.account, name: b.meta(p.account).name, dr: p.dr, cr: p.cr });
    out.set(p.entry.id, v);
  }
  return [...out.values()];
}

// ----------------------------------------------------------------------------- receipts & payments
export type RpRow = { key: string; name: string; cash: number; bank: number; total: number };
export type ReceiptsPayments = {
  openingCash: number; openingBank: number;
  receipts: RpRow[]; payments: RpRow[];
  totalReceipts: { cash: number; bank: number; total: number }; totalPayments: { cash: number; bank: number; total: number };
  closingCash: number; closingBank: number; balanced: boolean;
};

/** Cash and bank money in and out by head, from the opening balance to the closing balance. */
export function receiptsPayments(b: Books, scope: Scope, from: string, to: string): ReceiptsPayments {
  const fy = fyStart(to);
  const sumOf = (m: Map<string, number>) => {
    let cash = 0, bank = 0;
    for (const [k, v] of m) { if (k === "cash") cash += v; else if (isBankAccount(k)) bank += v; }
    return { cash: r2(cash), bank: r2(bank) };
  };
  const opening = sumOf(balances(b, scope, from, fy)), closing = sumOf(balances(b, scope, addDays(to, 1), fy));
  const rec = new Map<string, RpRow>(), pay = new Map<string, RpRow>();
  const bucket = (m: Map<string, RpRow>, key: string, name: string, bank: boolean, amount: number) => {
    const r = m.get(key) ?? { key, name, cash: 0, bank: 0, total: 0 };
    if (bank) r.bank += amount; else r.cash += amount;
    r.total += amount; m.set(key, r);
  };
  for (const p of b.postings) {
    if (!inScope(p.book, scope) || p.entry.entry_date < from || p.entry.entry_date > to || !isCashOrBank(p.account)) continue;
    const contra = (b.groups.get(`${p.entry.id}|${p.book}`) ?? []).find((q) => !isCashOrBank(q.account));
    const key = contra?.account ?? "other", name = key === "outstanding" ? "Outstanding expenses settled (bills paid)" : contra ? b.meta(key).name : "Other";
    if (p.dr > 0) bucket(rec, key, name, isBankAccount(p.account), p.dr);
    if (p.cr > 0) bucket(pay, key, name, isBankAccount(p.account), p.cr);
  }
  const fin = (m: Map<string, RpRow>) => [...m.values()].map((r) => ({ ...r, cash: r2(r.cash), bank: r2(r.bank), total: r2(r.total) })).sort((x, y) => x.name.localeCompare(y.name));
  const receipts = fin(rec), payments = fin(pay);
  const tot = (rows: RpRow[]) => ({ cash: r2(rows.reduce((s, r) => s + r.cash, 0)), bank: r2(rows.reduce((s, r) => s + r.bank, 0)), total: r2(rows.reduce((s, r) => s + r.total, 0)) });
  const totalReceipts = tot(receipts), totalPayments = tot(payments);
  const balanced = zero(opening.cash + totalReceipts.cash - totalPayments.cash - closing.cash) && zero(opening.bank + totalReceipts.bank - totalPayments.bank - closing.bank);
  return { openingCash: opening.cash, openingBank: opening.bank, receipts, payments, totalReceipts, totalPayments, closingCash: closing.cash, closingBank: closing.bank, balanced };
}

// ----------------------------------------------------------------------------- bank reconciliation
export type ReconItem = { date: string; voucherNo: string; particulars: string; receipt: number; payment: number };
export type BankRecon = {
  inBookNotOnStatement: ReconItem[]; onStatementNotInBook: ReconItem[];
  bookNet: number; statementNet: number; difference: number; matched: number;
  /** Statement rows carry no book, so they are only listed for "All books". */
  statementShown: boolean;
};

/** Bank-book entries with no statement row against them, and statement rows with no entry. */
export function bankRecon(b: Books, scope: Scope, txns: Txn[], to: string): BankRecon {
  const matched = new Set(txns.map((t) => t.matched_entry_id).filter(Boolean) as string[]);
  const seen = new Set<string>(), inBook: ReconItem[] = [];
  let matchedCount = 0;
  for (const p of b.postings) {
    if (!inScope(p.book, scope) || !isBankAccount(p.account) || p.entry.entry_date > to) continue;
    if (matched.has(p.entry.id)) { if (!seen.has(p.entry.id)) matchedCount++; seen.add(p.entry.id); continue; }
    inBook.push({ date: p.entry.entry_date, voucherNo: p.entry.voucher_no ?? "", particulars: particulars(b, p), receipt: p.dr, payment: p.cr });
  }
  const statementShown = scope === "all";
  const onStatement: ReconItem[] = statementShown
    ? txns.filter((t) => !t.matched_entry_id && t.txn_date <= to).map((t) => ({ date: t.txn_date, voucherNo: "", particulars: [t.description, t.reference].filter(Boolean).join(" · "), receipt: t.direction === "credit" ? t.amount : 0, payment: t.direction === "debit" ? t.amount : 0 }))
    : [];
  const net = (rows: ReconItem[]) => r2(rows.reduce((s, r) => s + r.receipt - r.payment, 0));
  const bookNet = net(inBook), statementNet = net(onStatement);
  return { inBookNotOnStatement: inBook, onStatementNotInBook: onStatement.sort((x, y) => x.date.localeCompare(y.date)), bookNet, statementNet, difference: r2(bookNet - statementNet), matched: matchedCount, statementShown };
}

// ----------------------------------------------------------------------------- the extra sheets
export type DayRow = { entry: Entry; income: number; expense: number; journal: number; particulars: string };

/** Day book: every entry in the period, in the order it happened, with the amount on the right side. */
export function dayBook(b: Books, scope: Scope, from: string, to: string): DayRow[] {
  return b.entries
    .filter((e) => e.voucher_no && e.entry_date >= from && e.entry_date <= to && entryInScope(b, e, scope))
    .sort((x, y) => x.entry_date.localeCompare(y.entry_date) || x.created_at.localeCompare(y.created_at))
    .map((e) => ({
      entry: e, income: e.type === "income" ? e.amount : 0, expense: e.type === "expense" ? e.amount : 0, journal: e.type === "journal" ? e.amount : 0,
      particulars: e.type === "journal"
        ? [b.names.cat(e.dr_category_id) && `Dr ${b.names.cat(e.dr_category_id)}`, e.jv_kind === "unpaid_bill" ? "Cr Outstanding expenses" : b.names.cat(e.cr_category_id) && `Cr ${b.names.cat(e.cr_category_id)}`, e.note].filter(Boolean).join(" · ")
        : [b.names.cat(e.category_id), b.names.person(e.person_id), e.note].filter(Boolean).join(" · "),
    }));
}

export type FundRow = { fund: string; income: number; expense: number; net: number };
/** Income and expense by the "fund source" typed on each entry. Real funds (FCRA, CSR, Building…) come later. */
export function fundWise(b: Books, scope: Scope, from: string, to: string): FundRow[] {
  const m = new Map<string, FundRow>();
  for (const e of b.entries) {
    if (e.type === "journal" || !e.voucher_no || e.entry_date < from || e.entry_date > to || !entryInScope(b, e, scope)) continue;
    const fund = e.fund_source?.trim() || "(no fund named)";
    const r = m.get(fund) ?? { fund, income: 0, expense: 0, net: 0 };
    if (e.type === "income") r.income += e.amount; else r.expense += e.amount;
    m.set(fund, r);
  }
  return [...m.values()].map((r) => ({ ...r, income: r2(r.income), expense: r2(r.expense), net: r2(r.income - r.expense) })).sort((x, y) => x.fund.localeCompare(y.fund));
}

export type MissingBill = { entry: Entry; status: "No bill (self-voucher)" | "Bill promised, not uploaded" };
/** Expenses with no bill: either never had one, or one is meant to come and has not. */
export function billsMissing(b: Books, scope: Scope, from: string, to: string): MissingBill[] {
  const out: MissingBill[] = [];
  for (const e of b.entries) {
    if (e.type !== "expense" || e.entry_date < from || e.entry_date > to || !entryInScope(b, e, scope)) continue;
    if (e.no_bill) out.push({ entry: e, status: "No bill (self-voucher)" });
    else if (e.receipt_available && !e.bill_path) out.push({ entry: e, status: "Bill promised, not uploaded" });
  }
  return out.sort((x, y) => x.entry.entry_date.localeCompare(y.entry.entry_date));
}

export type UnpaidBill = { entry: Entry; billed: number; paid: number; outstanding: number; days: number };
/** Bills booked by a journal that have not been fully paid as on `asOf`. */
export function unpaidBills(b: Books, scope: Scope, asOf: string): UnpaidBill[] {
  const paid = new Map<string, number>();
  for (const e of b.entries) if (e.settles_entry_id && e.entry_date <= asOf) paid.set(e.settles_entry_id, (paid.get(e.settles_entry_id) ?? 0) + e.amount);
  const out: UnpaidBill[] = [];
  for (const e of b.entries) {
    if (e.type !== "journal" || e.jv_kind !== "unpaid_bill" || e.entry_date > asOf || !entryInScope(b, e, scope)) continue;
    const p = r2(paid.get(e.id) ?? 0), left = r2(e.amount - p);
    if (zero(left) || left < 0) continue;
    out.push({ entry: e, billed: e.amount, paid: p, outstanding: left, days: Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${e.entry_date}T00:00:00Z`)) / 86400000) });
  }
  return out.sort((x, y) => x.entry.entry_date.localeCompare(y.entry.entry_date));
}

/** Income entries with no donor named. Hundi collections are anonymous by nature, so they are not listed. */
export function donationsWithoutDonor(b: Books, scope: Scope, from: string, to: string): Entry[] {
  return b.entries
    .filter((e) => e.type === "income" && !e.person_id && e.entry_date >= from && e.entry_date <= to && entryInScope(b, e, scope) && !/hundi/i.test(b.names.cat(e.category_id)))
    .sort((x, y) => x.entry_date.localeCompare(y.entry_date));
}
