"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy } from "@/lib/format";
import type { Entry, Txn } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { useWs } from "./WorkspaceProvider";
import { Modal, Receipt, btnDanger, btnGhost } from "./ui";

export default function EntryDetail({ entry, onClose, onEdit, onChanged }: { entry: Entry; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const { profile } = useAuth();
  const { canManage, canWrite, catName, itemName, personName, money } = useWs();
  const [txn, setTxn] = useState<Txn | null>(null);
  const [log, setLog] = useState<{ id: string; action: string; at: string; snapshot: Entry }[]>([]);
  useEffect(() => {
    if (!canManage) return;
    supabase.from("bank_transactions").select("*").eq("matched_entry_id", entry.id).maybeSingle().then(({ data }) => setTxn(data as Txn | null));
    supabase.from("entry_log").select("*").eq("entry_id", entry.id).order("at", { ascending: false }).then(({ data }) => setLog((data as typeof log) ?? []));
  }, [entry.id, canManage]);
  const mine = entry.created_by === profile.id && (!entry.claim_status || entry.claim_status === "submitted");
  const editable = canManage || (canWrite && mine);

  async function del() {
    if (!confirm("Delete this entry and its images?")) return;
    const files = [entry.bill_path, entry.payment_proof_path].filter(Boolean) as string[];
    const { error } = await supabase.from("entries").delete().eq("id", entry.id);
    if (error) return alert(error.message);
    if (files.length) await supabase.storage.from("receipts").remove(files);
    onChanged();
  }
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 border-b py-1.5 text-sm"><span className="text-slate-500">{k}</span><span className="text-right font-medium">{v || "—"}</span></div>;
  return (
    <Modal title={`${entry.type === "income" ? "Income" : "Expense"} · ${money(entry.amount)}`} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          {row("Date", dmy(entry.entry_date))}{row("Category", catName(entry.category_id))}{row("Item", itemName(entry.item_id))}
          {row(entry.type === "income" ? "Received from" : "Who paid", personName(entry.person_id))}{row("Mode", entry.payment_mode)}
          {row("Reference / UTR", entry.reference_no)}{row("Claim", entry.claim_status)}{row("Note", entry.note)}
          {canManage && <div className={`mt-3 rounded-lg p-3 text-sm ${txn ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            {txn ? <>✔ Matched to bank transaction {dmy(txn.txn_date)} · {money(txn.amount)}<div className="text-xs">{txn.description}</div></> : "Not yet matched to a bank transaction."}</div>}
          {log.length > 0 && <div className="mt-3 text-xs text-slate-500"><b>History</b>{log.map((l) => <div key={l.id}>{new Date(l.at).toLocaleString()} · {l.action} (was {money(l.snapshot.amount)}{l.snapshot.note ? `, “${l.snapshot.note}”` : ""})</div>)}</div>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Receipt path={entry.bill_path} label="Bill" size="lg" />
          <Receipt path={entry.payment_proof_path} label="Payment screenshot" size="lg" />
        </div>
      </div>
      {editable && <div className="mt-5 flex justify-end gap-2"><button className={btnGhost} onClick={onEdit}>Edit</button><button className={btnDanger} onClick={del}>Delete</button></div>}
    </Modal>
  );
}
