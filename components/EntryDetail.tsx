"use client";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { dmy } from "@/lib/format";
import type { Entry, Txn } from "@/lib/types";
import { useWs } from "./WorkspaceProvider";
import { Confirm, Modal, Receipt, btnDanger, btnGhost } from "./ui";
import { NoBillTag } from "./formKit";
import { JV_KINDS, VOUCHER_KINDS } from "@/lib/voucher";

export default function EntryDetail({ entry, onClose, onEdit, onChanged }: { entry: Entry; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const { canManage, canAccount, catName, itemName, personName, money, banks } = useWs();
  const [txn, setTxn] = useState<Txn | null>(null); const [confirming, setConfirming] = useState(false);
  const [settles, setSettles] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState<{ voucher_no: string | null; amount: number }[]>([]);
  const [log, setLog] = useState<{ id: string; action: string; at: string; snapshot: Entry }[]>([]);
  useEffect(() => {
    if (!canAccount) return;
    db.from("bank_transactions").select("*").eq("workspace_id", entry.workspace_id).eq("matched_entry_id", entry.id).maybeSingle().then(({ data }) => setTxn(data as Txn | null));
    db.from("entry_log").select("*").eq("workspace_id", entry.workspace_id).eq("entry_id", entry.id).order("at", { ascending: false }).then(({ data }) => setLog(((data as { id: string; action: string; at: string; snapshot: string | Entry }[]) ?? []).map((l) => ({ ...l, snapshot: typeof l.snapshot === "string" ? JSON.parse(l.snapshot) : l.snapshot }))));
  }, [entry.id, entry.workspace_id, canAccount]);
  // The bill this payment clears, or the payments that clear this bill (whoever keeps the books can see both).
  useEffect(() => {
    if (!canAccount) return;
    if (entry.settles_entry_id) db.from("entries").select("voucher_no").eq("id", entry.settles_entry_id).maybeSingle().then(({ data }) => setSettles((data as { voucher_no: string | null } | null)?.voucher_no ?? "—"));
    if (entry.jv_kind === "unpaid_bill") db.from("entries").select("voucher_no, amount").eq("settles_entry_id", entry.id).then(({ data }) => setPaidOn((data as { voucher_no: string | null; amount: number }[]) ?? []));
  }, [entry.id, entry.settles_entry_id, entry.jv_kind, canAccount]);
  const journal = entry.type === "journal";
  // Editing and deleting is for owners, admins and super admins only — entry users and the main accountant add, never
  // change. The database refuses it either way ("entries update" / "entries delete").
  const editable = canManage;

  async function del() {
    const files = [entry.bill_path, entry.payment_proof_path].filter(Boolean) as string[];
    const { error } = await db.from("entries").delete().eq("id", entry.id);
    if (error) throw new Error(error.message);
    if (files.length) await db.storage.from("receipts").remove(files);
    onChanged();
  }
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 border-b py-1.5 text-sm"><span className="text-slate-500">{k}</span><span className="text-right font-medium">{v || "—"}</span></div>;
  return (
    <Modal title={`${entry.voucher_type ? VOUCHER_KINDS[entry.voucher_type].label : entry.type === "income" ? "Income" : "Expense"} · ${money(entry.amount)}`} onClose={onClose} wide={!journal}>
      <div className={journal ? "" : "grid gap-5 md:grid-cols-2"}>
        <div>
          {entry.voucher_no && row("Voucher no.", <span className="font-mono">{entry.voucher_no}</span>)}
          {row("Date", dmy(entry.entry_date))}
          {journal ? <>
            {row("Journal for", entry.jv_kind ? JV_KINDS[entry.jv_kind].label : "")}
            {row("Debit", catName(entry.dr_category_id))}
            {row("Credit", entry.jv_kind === "unpaid_bill" ? "Outstanding expenses" : catName(entry.cr_category_id))}
            {row("Narration", entry.note)}
            {entry.jv_kind === "unpaid_bill" && row("Paid so far", paidOn.length ? `${money(paidOn.reduce((s, p) => s + Number(p.amount), 0))} of ${money(entry.amount)} (${paidOn.map((p) => p.voucher_no).join(", ")})` : "Nothing yet")}
          </> : <>
            {row("Category", catName(entry.category_id))}{row("Item", itemName(entry.item_id))}
            {row(entry.type === "income" ? "Received from" : "Who paid", personName(entry.person_id))}{row("Mode", entry.payment_mode)}
            {entry.bank_account_id && row("Bank account", banks.find((b) => b.id === entry.bank_account_id)?.name)}
            {row("Reference / UTR", entry.reference_no)}{row("Claim", entry.claim_status)}{row("Note", entry.note)}
            {entry.settles_entry_id && row("Pays unpaid bill", <span className="font-mono">{settles ?? "…"}</span>)}
            {entry.no_bill && row("Bill", <><span>No bill — self-voucher</span><NoBillTag /></>)}
          </>}
          {canAccount && <div className={`mt-3 rounded-lg p-3 text-sm ${txn ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            {txn ? <>✔ Matched to bank transaction {dmy(txn.txn_date)} · {money(txn.amount)}<div className="text-xs">{txn.description}</div></> : "Not yet matched to a bank transaction."}</div>}
          {log.length > 0 && <div className="mt-3 text-xs text-slate-500"><b>History</b>{log.map((l) => <div key={l.id}>{new Date(l.at).toLocaleString()} · {l.action} (was {money(l.snapshot.amount)}{l.snapshot.note ? `, “${l.snapshot.note}”` : ""})</div>)}</div>}
        </div>
        {!journal && <div className="grid grid-cols-2 gap-3">
          <Receipt path={entry.bill_path} label="Bill" size="lg" />
          <Receipt path={entry.payment_proof_path} label="Payment screenshot" size="lg" />
        </div>}
      </div>
      {editable && <div className="mt-5 flex justify-end gap-2"><button className={btnGhost} onClick={onEdit}>Edit</button><button className={btnDanger} onClick={() => setConfirming(true)}>Delete</button></div>}
      {confirming && (
        <Confirm title={journal ? "Delete this journal voucher" : "Delete this entry"} confirmLabel="Delete" danger onClose={() => setConfirming(false)} onConfirm={del}>
          <p>Delete this {journal ? "journal voucher" : entry.type} of <b>{money(entry.amount)}</b> from {dmy(entry.entry_date)}{journal ? "" : ", along with its bill and payment photos"}?</p>
          {entry.voucher_no && <p className="text-slate-500">Voucher number <span className="font-mono">{entry.voucher_no}</span> will not be reused.</p>}
          <p className="text-slate-500">Owners, admins and the main accountant can still see that it was deleted, in the entry’s history.</p>
        </Confirm>
      )}
    </Modal>
  );
}
