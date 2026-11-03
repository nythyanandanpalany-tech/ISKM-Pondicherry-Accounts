"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy, inr } from "@/lib/format";
import type { Expense, Txn } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { Modal, Receipt, StatusBadge, btnDanger, btnGhost, btnPrimary } from "./ui";

export default function ExpenseDetail({ expense, catName, accName, onClose, onEdit, onChanged }: {
  expense: Expense; catName: string; accName: string; onClose: () => void; onEdit: () => void; onChanged: () => void;
}) {
  const { isStaff, profile } = useAuth();
  const [txn, setTxn] = useState<Txn | null>(null);
  useEffect(() => {
    supabase.from("bank_transactions").select("*").eq("matched_expense_id", expense.id).maybeSingle().then(({ data }) => setTxn(data as Txn | null));
  }, [expense.id]);
  const canEdit = isStaff || (expense.created_by === profile.id && expense.status === "pending");

  async function setStatus(status: string) {
    await supabase.from("expenses").update({ status }).eq("id", expense.id); onChanged();
  }
  async function del() {
    if (!confirm("Delete this expense and its images?")) return;
    const files = [expense.payment_proof_path, expense.bill_path].filter(Boolean) as string[];
    const { error } = await supabase.from("expenses").delete().eq("id", expense.id);
    if (error) return alert(error.message);
    if (files.length) await supabase.storage.from("receipts").remove(files);
    onChanged();
  }
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 border-b py-1.5 text-sm"><span className="text-slate-500">{k}</span><span className="text-right font-medium">{v || "—"}</span></div>;

  return (
    <Modal title={expense.title} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          {row("Amount", inr(expense.amount))}{row("Date", dmy(expense.expense_date))}{row("Vendor", expense.vendor)}
          {row("Category", catName)}{row("Account", accName)}{row("Mode", expense.payment_mode)}{row("UTR", expense.utr)}
          {row("Status", <StatusBadge status={expense.status} />)}{row("Notes", expense.notes)}
          <div className={`mt-3 rounded-lg p-3 text-sm ${txn ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            {txn ? <>✔ Matched to bank transaction: <b>{dmy(txn.txn_date)}</b> · {inr(txn.amount)}<div className="text-xs">{txn.description}</div></> : "Not yet matched to a bank transaction."}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Receipt path={expense.payment_proof_path} label="Payment screenshot" size="lg" />
          <Receipt path={expense.bill_path} label="Bill" size="lg" />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {isStaff && expense.status !== "approved" && <button className={btnPrimary} onClick={() => setStatus("approved")}>Approve</button>}
        {isStaff && expense.status !== "rejected" && <button className={btnDanger} onClick={() => setStatus("rejected")}>Reject</button>}
        {isStaff && expense.status !== "pending" && <button className={btnGhost} onClick={() => setStatus("pending")}>Mark pending</button>}
        {canEdit && <button className={btnGhost} onClick={onEdit}>Edit</button>}
        {canEdit && <button className={btnDanger} onClick={del}>Delete</button>}
      </div>
    </Modal>
  );
}
