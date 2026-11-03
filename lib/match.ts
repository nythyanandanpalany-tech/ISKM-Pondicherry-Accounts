import { daysBetween } from "./format";
import type { Expense, Txn } from "./types";

export type Candidate = { expense: Expense; score: number; reasons: string[] };

/** Rank unmatched expenses as possible matches for a bank transaction. */
export function suggest(txn: Txn, expenses: Expense[]): Candidate[] {
  const hay = `${txn.description ?? ""} ${txn.reference ?? ""}`.toLowerCase();
  return expenses
    .map((expense) => {
      let score = 0;
      const reasons: string[] = [];
      if (Math.abs(expense.amount - txn.amount) < 0.005) { score += 50; reasons.push("Amount matches"); }
      if (expense.utr && expense.utr.length >= 6 && hay.includes(expense.utr.toLowerCase())) {
        score += 60; reasons.push("UTR found in statement");
      }
      const d = daysBetween(expense.expense_date, txn.txn_date);
      if (d === 0) { score += 20; reasons.push("Same day"); }
      else if (d <= 3) { score += 10; reasons.push(`${d} day${d > 1 ? "s" : ""} apart`); }
      const v = (expense.vendor ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (v.some((w) => hay.includes(w))) { score += 10; reasons.push("Vendor name in statement"); }
      return { expense, score, reasons };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}
