import { daysBetween } from "./format";
import type { Entry, Txn } from "./types";

export type Candidate = { entry: Entry; score: number; reasons: string[] };

/** Rank unmatched entries as possible matches for a bank transaction. */
export function suggest(txn: Txn, entries: Entry[], personName: (id: string | null) => string): Candidate[] {
  const hay = `${txn.description ?? ""} ${txn.reference ?? ""}`.toLowerCase();
  return entries
    .filter((e) => (txn.direction === "debit") === (e.type === "expense"))
    .map((entry) => {
      let score = 0; const reasons: string[] = [];
      if (Math.abs(entry.amount - txn.amount) < 0.005) { score += 50; reasons.push("Amount matches"); }
      if (entry.reference_no && entry.reference_no.length >= 6 && hay.includes(entry.reference_no.toLowerCase())) { score += 60; reasons.push("UTR found in statement"); }
      const d = daysBetween(entry.entry_date, txn.txn_date);
      if (d === 0) { score += 20; reasons.push("Same day"); } else if (d <= 3) { score += 10; reasons.push(`${d} day${d > 1 ? "s" : ""} apart`); }
      if (personName(entry.person_id).toLowerCase().split(/\s+/).some((w) => w.length > 3 && hay.includes(w))) { score += 10; reasons.push("Name in statement"); }
      return { entry, score, reasons };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}
