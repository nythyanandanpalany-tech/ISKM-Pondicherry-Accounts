/**
 * Voucher numbering, as the database does it (supabase/migrations/20260101000005_vouchers.sql).
 *
 * The database is the authority: a trigger hands out every number, so two people saving at the same
 * moment can never collide. This file only mirrors the rules so the entry form can say, before
 * saving, what kind of voucher this will be — and the tests pin it to the same examples the
 * database tests use.
 *
 *   2026-2027 / BV / 11 / V018
 *   financial year (April–March) · type · calendar month of the entry date · serial
 *
 * The serial restarts every month, separately for each type.
 */
import type { Entry, JvKind, VoucherKind } from "./types";

export type { JvKind, VoucherKind };

/** Entries dated on or after this are vouchers. The database column is workspaces.vouchers_from. */
export const VOUCHERS_FROM = "2026-11-01";

export const VOUCHER_KINDS: Record<VoucherKind, { label: string; short: string; party: string }> = {
  CV: { label: "Cash Voucher", short: "Cash expense", party: "Paid to" },
  BV: { label: "Bank Voucher", short: "Bank expense", party: "Paid to" },
  CR: { label: "Cash Receipt", short: "Cash donation / income", party: "Received from" },
  BR: { label: "Bank Receipt", short: "Bank donation / income", party: "Received from" },
  JV: { label: "Journal Voucher", short: "Adjustment, no cash or bank", party: "" },
};

/** The three reasons for a journal voucher, in the words the accountant uses. */
export const JV_KINDS: Record<JvKind, { label: string; hint: string }> = {
  unpaid_bill: { label: "Bill not yet paid", hint: "Books the expense now and owes the money (credits Outstanding expenses)." },
  transfer: { label: "Move an amount between heads", hint: "Takes the amount out of one head and puts it in another." },
  correction: { label: "Correct a mistake", hint: "Fixes an entry that was booked to the wrong head." },
};

/** Financial year of a YYYY-MM-DD date: April–March, so 2026-11-19 and 2027-02-10 are both "2026-2027". */
export function financialYear(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return m >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/** Cash is cash; UPI, bank transfer, cheque, card and "other" all pass through a bank. */
export function voucherKind(type: Entry["type"], mode: string): VoucherKind {
  if (type === "journal") return "JV";
  const cash = mode.trim().toLowerCase() === "cash";
  return type === "expense" ? (cash ? "CV" : "BV") : cash ? "CR" : "BR";
}

/** 2026-2027/BV/11/V018. Padded to three digits, never truncated past 999. */
export function formatVoucherNo(fy: string, kind: VoucherKind, month: number, seq: number): string {
  return `${fy}/${kind}/${String(month).padStart(2, "0")}/V${seq < 100 ? String(seq).padStart(3, "0") : seq}`;
}

/** What a new entry will be numbered as, minus the serial. null = before the module starts. */
export function voucherPreview(type: Entry["type"], mode: string, date: string, from: string | null = VOUCHERS_FROM) {
  if (!date || !from || date < from) return null;
  const kind = voucherKind(type, mode);
  return { kind, label: VOUCHER_KINDS[kind].label, series: `${financialYear(date)}/${kind}/${date.slice(5, 7)}` };
}

/** The first line of a ledger row: the category, or for a journal the two heads it joins. */
export function entryHead(e: Entry, catName: (id: string | null) => string): string {
  if (e.type !== "journal") return catName(e.category_id);
  const dr = catName(e.dr_category_id) || "—";
  const cr = e.jv_kind === "unpaid_bill" ? "Outstanding expenses" : catName(e.cr_category_id) || "—";
  return `Dr ${dr} · Cr ${cr}`;
}
