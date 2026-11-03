"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { today } from "@/lib/format";
import type { Account, Category, Expense } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { Modal, input, btnPrimary, btnGhost, Receipt } from "./ui";

const label = "mb-1 block text-xs font-medium text-slate-600";

function FilePick({ title, hint, file, existing, onFile, onClear }: {
  title: string; hint: string; file: File | null; existing: string | null;
  onFile: (f: File) => void; onClear: () => void;
}) {
  const preview = file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mb-2 text-xs text-slate-500">{hint}</div>
      {file ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" className="h-36 w-full rounded-lg border object-contain" /> : <div className="rounded-lg bg-slate-50 p-3 text-xs">{file.name}</div>}
          <button type="button" onClick={onClear} className="text-xs text-red-600">Remove</button>
        </div>
      ) : existing ? (
        <div className="space-y-2">
          <Receipt path={existing} label="Current file" />
          <label className="cursor-pointer text-xs text-indigo-600">Replace
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
      ) : (
        <label className="flex h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-indigo-400">
          Tap to upload or take photo
          <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}

export default function ExpenseForm({ expense, categories, accounts, onClose, onSaved }: {
  expense?: Expense; categories: Category[]; accounts: Account[]; onClose: () => void; onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [f, setF] = useState({
    expense_date: expense?.expense_date ?? today(), title: expense?.title ?? "", vendor: expense?.vendor ?? "",
    amount: expense?.amount?.toString() ?? "", category_id: expense?.category_id ?? "", account_id: expense?.account_id ?? "",
    payment_mode: expense?.payment_mode ?? "upi", utr: expense?.utr ?? "", notes: expense?.notes ?? "",
  });
  const [proof, setProof] = useState<File | null>(null);
  const [bill, setBill] = useState<File | null>(null);
  const [clearProof, setClearProof] = useState(false);
  const [clearBill, setClearBill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function upload(file: File): Promise<string> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${expense?.created_by ?? profile.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("receipts").upload(path, file, { contentType: file.type });
    if (error) throw error;
    return path;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      let payment_proof_path = clearProof ? null : expense?.payment_proof_path ?? null;
      let bill_path = clearBill ? null : expense?.bill_path ?? null;
      const stale: string[] = [];
      if (proof) { if (payment_proof_path || expense?.payment_proof_path) stale.push(expense?.payment_proof_path ?? ""); payment_proof_path = await upload(proof); }
      else if (clearProof && expense?.payment_proof_path) stale.push(expense.payment_proof_path);
      if (bill) { if (expense?.bill_path) stale.push(expense.bill_path); bill_path = await upload(bill); }
      else if (clearBill && expense?.bill_path) stale.push(expense.bill_path);

      const row = {
        expense_date: f.expense_date, title: f.title.trim(), vendor: f.vendor.trim() || null, amount: parseFloat(f.amount),
        category_id: f.category_id || null, account_id: f.account_id || null, payment_mode: f.payment_mode,
        utr: f.utr.trim() || null, notes: f.notes.trim() || null, payment_proof_path, bill_path,
      };
      const q = expense ? supabase.from("expenses").update(row).eq("id", expense.id) : supabase.from("expenses").insert(row);
      const { error } = await q;
      if (error) throw error;
      const toRemove = stale.filter(Boolean);
      if (toRemove.length) await supabase.storage.from("receipts").remove(toRemove);
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : (ex as { message?: string })?.message ?? "Could not save");
    } finally { setBusy(false); }
  }

  return (
    <Modal title={expense ? "Edit expense" : "Add expense"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={label}>Title / what was it for *</label><input className={input} value={f.title} onChange={set("title")} required /></div>
          <div><label className={label}>Vendor / paid to</label><input className={input} value={f.vendor} onChange={set("vendor")} /></div>
          <div><label className={label}>Amount (₹) *</label><input className={input} type="number" step="0.01" min="0" value={f.amount} onChange={set("amount")} required /></div>
          <div><label className={label}>Date *</label><input className={input} type="date" value={f.expense_date} onChange={set("expense_date")} required /></div>
          <div><label className={label}>Category</label>
            <select className={input} value={f.category_id} onChange={set("category_id")}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className={label}>Paid from account</label>
            <select className={input} value={f.account_id} onChange={set("account_id")}><option value="">—</option>{accounts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className={label}>Payment mode</label>
            <select className={input} value={f.payment_mode} onChange={set("payment_mode")}>{["upi", "bank transfer", "cash", "card", "cheque"].map((m) => <option key={m}>{m}</option>)}</select></div>
          <div><label className={label}>UTR / transaction ID (helps auto-matching)</label><input className={input} value={f.utr} onChange={set("utr")} placeholder="e.g. 412345678901" /></div>
        </div>
        <div><label className={label}>Notes</label><textarea className={input} rows={2} value={f.notes} onChange={set("notes")} /></div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FilePick title="1. Payment screenshot" hint="Screenshot from GPay / PhonePe / bank app showing the payment" file={proof}
            existing={clearProof ? null : expense?.payment_proof_path ?? null} onFile={(x) => { setProof(x); setClearProof(false); }} onClear={() => { setProof(null); setClearProof(true); }} />
          <FilePick title="2. Bill / invoice" hint="Photo or PDF of the bill this payment was made for" file={bill}
            existing={clearBill ? null : expense?.bill_path ?? null} onFile={(x) => { setBill(x); setClearBill(false); }} onClear={() => { setBill(null); setClearBill(true); }} />
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={busy}>{busy ? "Saving…" : "Save expense"}</button>
        </div>
      </form>
    </Modal>
  );
}
