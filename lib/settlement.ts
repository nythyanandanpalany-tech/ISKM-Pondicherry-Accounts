/**
 * Weekly settlement (calendar week, Monday to Sunday).
 *
 * A week is settled when four things are true:
 *   1. Bank matched          every bank voucher of the week is matched to a bank-statement row, and
 *                            no statement row dated in the week is left without an entry
 *   2. Cash counted          someone counted the cash in hand at the end of the week and it agrees
 *                            with the cash book (all books together — there is one cash box)
 *   3. Trial balance tallies for every book and for all of them together, with opening balances
 *                            that tally too
 *   4. Bills attached        no expense of the week is still "bill promised, not uploaded"; a cash
 *                            self-voucher flagged No bill is allowed and only listed
 *
 * Only the cash count and the settling itself are stored (table week_settlements); everything else
 * is worked out from the vouchers each time, so the checks can never disagree with the reports.
 * Settling locks nothing (no month-locking): if a settled week changes afterwards, `changed` says so.
 *
 * Pure — no React, no database — so it is covered by lib/tests/settlement.test.mjs.
 */
import { balances, r2, SCOPES, trialBalance, type Books, type Scope } from "./accounts";
import { addDays, fyStart, weekRange, type Range } from "./periods";
import type { Entry, Txn } from "./types";

export type WeekSettlementRow = {
  workspace_id: string; week_start: string;
  cash_counted: number | null; cash_note: string | null; counted_by: string | null; counted_at: string | null;
  settled_by: string | null; settled_at: string | null; snapshot: { fingerprint?: string } | null;
};

export type BankItem = { date: string; voucherNo: string; text: string; amount: number; direction: "in" | "out" };
export type WeekCheck = {
  week: Range;
  /** The week has ended (its Sunday is today or earlier), so it may be settled. */
  ended: boolean;
  bank: { ok: boolean; vouchers: number; matched: number; unmatchedVouchers: BankItem[]; unmatchedStatement: BankItem[] };
  cash: { ok: boolean; book: number; counted: number | null; difference: number | null };
  tb: { ok: boolean; books: { scope: Scope; label: string; dr: number; cr: number; balanced: boolean }[]; openingDiff: boolean };
  bills: { ok: boolean; waiting: Entry[]; selfVouchers: Entry[] };
  /** All four checks pass. */
  ready: boolean;
  settled: boolean;
  /** Settled, but the vouchers or the cash book have changed since. */
  changed: boolean;
  /** What the week looks like now, saved when it is settled. */
  fingerprint: string;
};

const zero = (n: number) => Math.abs(n) < 0.005;
const isCash = (e: Entry) => e.payment_mode.trim().toLowerCase() === "cash";

/** Today's date in India: a settlement made at 1 am IST on Monday belongs to Monday, not to Sunday UTC. */
export function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Every week from the one the vouchers start in up to the current one, newest first. */
export function weeksSince(vouchersFrom: string | null, today: string): Range[] {
  const out: Range[] = [];
  const first = weekRange(vouchersFrom ?? today).from;
  for (let w = weekRange(today); w.from >= first; w = weekRange(addDays(w.from, -1))) out.push(w);
  return out;
}

/** The cash book's balance, all books together, at the end of `date`. */
export function cashAt(b: Books, date: string): number {
  return r2(balances(b, "all", addDays(date, 1), fyStart(date)).get("cash") ?? 0);
}

export function checkWeek(b: Books, txns: Txn[], week: Range, saved: WeekSettlementRow | undefined, today: string): WeekCheck {
  const inWeek = (d: string) => d >= week.from && d <= week.to;
  const vouchers = b.entries.filter((e) => e.voucher_no && inWeek(e.entry_date));

  // 1. Bank matched
  const matchedIds = new Set(txns.map((t) => t.matched_entry_id).filter(Boolean) as string[]);
  const bankVouchers = vouchers.filter((e) => e.type !== "journal" && !isCash(e));
  const text = (e: Entry) => [b.names.cat(e.type === "journal" ? e.dr_category_id : e.category_id), b.names.person(e.person_id), e.note].filter(Boolean).join(" · ");
  const unmatchedVouchers: BankItem[] = bankVouchers.filter((e) => !matchedIds.has(e.id))
    .map((e) => ({ date: e.entry_date, voucherNo: e.voucher_no ?? "", text: text(e), amount: e.amount, direction: e.type === "income" ? "in" : "out" }));
  const unmatchedStatement: BankItem[] = txns.filter((t) => !t.matched_entry_id && inWeek(t.txn_date))
    .map((t) => ({ date: t.txn_date, voucherNo: "", text: [t.description, t.reference].filter(Boolean).join(" · "), amount: t.amount, direction: t.direction === "credit" ? "in" : "out" }));
  const byDate = (x: BankItem, y: BankItem) => x.date.localeCompare(y.date);
  const bank = {
    ok: !unmatchedVouchers.length && !unmatchedStatement.length,
    vouchers: bankVouchers.length, matched: bankVouchers.length - unmatchedVouchers.length,
    unmatchedVouchers: unmatchedVouchers.sort(byDate), unmatchedStatement: unmatchedStatement.sort(byDate),
  };

  // 2. Cash counted
  const book = cashAt(b, week.to);
  const counted = saved?.cash_counted == null ? null : Number(saved.cash_counted);
  const difference = counted == null ? null : r2(counted - book);
  const cash = { ok: difference != null && zero(difference), book, counted, difference };

  // 3. Trial balance tallies — each book on its own and all together, over the week.
  const tbs = SCOPES.map(({ id, label }) => {
    const t = trialBalance(b, id, week.from, week.to);
    return { scope: id, label, dr: t.totals.closeDr, cr: t.totals.closeCr, balanced: t.balanced, openingDiff: t.rows.some((r) => r.key === "opening_diff") };
  });
  const openingDiff = tbs.some((t) => t.openingDiff);
  const tb = { ok: tbs.every((t) => t.balanced) && !openingDiff, books: tbs.map((t) => ({ scope: t.scope, label: t.label, dr: t.dr, cr: t.cr, balanced: t.balanced })), openingDiff };

  // 4. Bills attached
  const expenses = vouchers.filter((e) => e.type === "expense");
  const waiting = expenses.filter((e) => e.receipt_available && !e.bill_path);
  const selfVouchers = expenses.filter((e) => e.no_bill);
  const bills = { ok: !waiting.length, waiting, selfVouchers };

  // Anything that would change a figure on the checks: the week's vouchers (added, removed, edited) and the cash book.
  const latest = vouchers.reduce((m, e) => (e.updated_at > m ? e.updated_at : m), "");
  const total = r2(vouchers.reduce((s, e) => s + e.amount, 0));
  const fingerprint = `${vouchers.length}|${total}|${latest}|${book}`;

  const ready = bank.ok && cash.ok && tb.ok && bills.ok;
  const settled = !!saved?.settled_at;
  const changed = settled && saved?.snapshot?.fingerprint != null && saved.snapshot.fingerprint !== fingerprint;
  return { week, ended: week.to <= today, bank, cash, tb, bills, ready, settled, changed, fingerprint };
}

/** The four checks by name, in the order the spec lists them. */
export const CHECKS = [
  { key: "bank", label: "Bank matched" },
  { key: "cash", label: "Cash counted" },
  { key: "tb", label: "Trial balance tallies" },
  { key: "bills", label: "Bills attached" },
] as const;

export type Status = "settled" | "changed" | "ready" | "open" | "running";
/** One word for the week: settled; settled but changed since; ready to settle; open (something to do); still running. */
export function statusOf(c: WeekCheck): Status {
  if (c.settled) return c.changed || !c.ready ? "changed" : "settled";
  if (!c.ended) return "running";
  return c.ready ? "ready" : "open";
}
