"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { today } from "@/lib/format";
import { compressImage, MAX_PDF_MB } from "@/lib/compress";
import { MODES, type Entry } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { useWs } from "./WorkspaceProvider";
import { Modal, Receipt, btnGhost, btnPrimary, input } from "./ui";

const lbl = "mb-1 block text-xs font-medium text-slate-600";

function FilePick({ title, hint, required, file, existing, onFile, onClear }: {
  title: string; hint: string; required?: boolean; file: File | null; existing: string | null; onFile: (f: File) => void; onClear: () => void;
}) {
  const preview = file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
  const pick = (cls: string, text: string, cap?: boolean) => (
    <label className={cls}>{text}
      <input type="file" accept="image/*,application/pdf" capture={cap ? "environment" : undefined} className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
  return (
    <div className={`rounded-xl border p-3 ${required && !file && !existing ? "border-amber-300" : "border-slate-200"}`}>
      <div className="text-sm font-semibold">{title}{required && <span className="text-red-500"> *</span>}</div>
      <div className="mb-2 text-xs text-slate-500">{hint}</div>
      {file ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" className="h-36 w-full rounded-lg border object-contain" /> : <div className="rounded-lg bg-slate-50 p-3 text-xs">{file.name}</div>}
          <button type="button" onClick={onClear} className="text-xs text-red-600">Remove</button>
        </div>
      ) : existing ? (
        <div className="space-y-2"><Receipt path={existing} label="Current file" />
          <div className="flex gap-3 text-xs">{pick("cursor-pointer text-indigo-600", "Replace")}<button type="button" onClick={onClear} className="text-red-600">Remove</button></div></div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {pick("flex h-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-indigo-400", "📷 Take photo", true)}
          {pick("flex h-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-indigo-400", "🖼 From gallery")}
        </div>
      )}
    </div>
  );
}

export default function EntryForm({ entry, onClose, onSaved }: { entry?: Entry; onClose: () => void; onSaved: () => void }) {
  const { profile, advanced } = useAuth();
  const { ws, categories, items, people, reload } = useWs();
  const [type, setType] = useState<"expense" | "income">(entry?.type ?? "expense");
  const [f, setF] = useState({
    entry_date: entry?.entry_date ?? today(), amount: entry?.amount?.toString() ?? "", category_id: entry?.category_id ?? "",
    item_id: entry?.item_id ?? "", person_id: entry?.person_id ?? "", payment_mode: entry?.payment_mode ?? "Cash",
    note: entry?.note ?? "", fund_source: entry?.fund_source ?? "", beneficiary: entry?.beneficiary ?? "", reference_no: entry?.reference_no ?? "", receipt_available: entry?.receipt_available ?? false,
    claim: !!entry?.claim_status,
  });
  const [newPerson, setNewPerson] = useState("");
  const [proof, setProof] = useState<File | null>(null); const [bill, setBill] = useState<File | null>(null);
  const [dropProof, setDropProof] = useState(false); const [dropBill, setDropBill] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const cats = categories.filter((c) => c.kind === type);
  const its = items.filter((i) => i.category_id === f.category_id);
  const hasBill = !!bill || (!!entry?.bill_path && !dropBill);
  const needBill = f.receipt_available && !hasBill;
  const digital = f.payment_mode === "UPI" || f.payment_mode === "Bank Transfer" || f.payment_mode === "Card";

  async function upload(file: File) {
    if (file.type === "application/pdf" && file.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`PDF is over ${MAX_PDF_MB} MB. Please photograph the bill instead (photos are compressed automatically).`);
    const small = await compressImage(file);
    const ext = small.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${ws.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("receipts").upload(path, small, { contentType: small.type });
    if (error) throw error;
    return path;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (needBill) return setErr("Attach the bill photo, or set “Receipt available” to No.");
    setBusy(true); setErr("");
    try {
      let person_id = f.person_id || null;
      if (person_id === "__new" && newPerson.trim()) {
        const { data, error } = await supabase.from("people").insert({ workspace_id: ws.id, name: newPerson.trim() }).select().single();
        if (error) throw error; person_id = data.id; await reload();
      } else if (person_id === "__new") person_id = null;

      let bill_path = dropBill ? null : entry?.bill_path ?? null, payment_proof_path = dropProof ? null : entry?.payment_proof_path ?? null;
      const stale: string[] = [];
      if (bill) { if (entry?.bill_path) stale.push(entry.bill_path); bill_path = await upload(bill); } else if (dropBill && entry?.bill_path) stale.push(entry.bill_path);
      if (proof) { if (entry?.payment_proof_path) stale.push(entry.payment_proof_path); payment_proof_path = await upload(proof); } else if (dropProof && entry?.payment_proof_path) stale.push(entry.payment_proof_path);

      const claim_status = type === "expense" && f.claim ? entry?.claim_status ?? "submitted" : null;
      const row = {
        type, entry_date: f.entry_date, amount: parseFloat(f.amount), category_id: f.category_id || null, item_id: f.item_id || null,
        person_id, payment_mode: f.payment_mode, note: f.note.trim() || null, reference_no: f.reference_no.trim() || null,
        receipt_available: f.receipt_available, fund_source: f.fund_source.trim() || null, beneficiary: f.beneficiary.trim() || null, bill_path, payment_proof_path, claim_status,
      };
      const { error } = entry
        ? await supabase.from("entries").update(row).eq("id", entry.id)
        : await supabase.from("entries").insert({ ...row, workspace_id: ws.id, created_by: profile.id });
      if (error) throw error;
      if (stale.length) await supabase.storage.from("receipts").remove(stale);
      onSaved();
    } catch (ex) { setErr((ex as { message?: string })?.message ?? "Could not save"); } finally { setBusy(false); }
  }

  return (
    <Modal title={entry ? "Edit entry" : "Add entry"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="inline-flex rounded-lg border p-0.5 text-sm">
          {(["expense", "income"] as const).map((t) => (
            <button key={t} type="button" onClick={() => { setType(t); setF({ ...f, category_id: "", item_id: "", claim: false }); }}
              className={`rounded-md px-4 py-1.5 ${type === t ? "bg-indigo-600 text-white" : "text-slate-600"}`}>{t === "expense" ? "Expense" : "+ Income"}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className={lbl}>Date *</label><input className={input} type="date" value={f.entry_date} onChange={set("entry_date")} required /></div>
          <div><label className={lbl}>Amount ({ws.currency}) *</label><input className={input} type="number" step="0.01" min="0" value={f.amount} onChange={set("amount")} required autoFocus /></div>
          <div><label className={lbl}>Payment mode</label><select className={input} value={f.payment_mode} onChange={set("payment_mode")}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div><label className={lbl}>{type === "expense" ? "Category" : "Income source"}</label>
            <select className={input} value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value, item_id: "" })}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className={lbl}>{type === "expense" ? "Item" : "Detail"}</label>
            <select className={input} value={f.item_id} onChange={set("item_id")} disabled={!its.length}><option value="">{its.length ? "—" : "No items"}</option>{its.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className={lbl}>{type === "expense" ? "Who paid" : "Received from"}</label>
            <select className={input} value={f.person_id} onChange={set("person_id")}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="__new">+ Add new name…</option></select>
            {f.person_id === "__new" && <input className={`${input} mt-1`} placeholder="Name" value={newPerson} onChange={(e) => setNewPerson(e.target.value)} />}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={lbl}>{type === "income" ? "Reference No." : "UTR / transaction ID (helps bank matching)"}</label>
            <input className={input} value={f.reference_no} onChange={set("reference_no")} placeholder={digital ? "e.g. 412345678901" : ""} /></div>
          <div><label className={lbl}>Note (optional)</label><input className={input} value={f.note} onChange={set("note")} /></div>
        </div>
        {advanced && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={lbl}>Fund source (advanced)</label><input className={input} value={f.fund_source} onChange={set("fund_source")} placeholder="e.g. Annadanam fund" /></div>
            <div><label className={lbl}>Beneficiary (advanced)</label><input className={input} value={f.beneficiary} onChange={set("beneficiary")} placeholder="who / what it benefits" /></div>
          </div>
        )}
        {type === "expense" && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.claim} onChange={(e) => setF({ ...f, claim: e.target.checked })} />
            Paid from own pocket — claim reimbursement</label>
        )}
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium">Receipt / bill available?</span>
          {[true, false].map((v) => <label key={String(v)} className="flex items-center gap-1"><input type="radio" checked={f.receipt_available === v} onChange={() => setF({ ...f, receipt_available: v })} />{v ? "Yes" : "No"}</label>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FilePick title="Bill / invoice photo" hint="The bill this payment was made for. Photos are shrunk automatically to save space." required={f.receipt_available} file={bill}
            existing={dropBill ? null : entry?.bill_path ?? null} onFile={(x) => { setBill(x); setDropBill(false); }} onClear={() => { setBill(null); setDropBill(true); }} />
          <FilePick title="Payment screenshot" hint="GPay / PhonePe / bank app screenshot. Used to match the bank statement." file={proof}
            existing={dropProof ? null : entry?.payment_proof_path ?? null} onFile={(x) => { setProof(x); setDropProof(false); }} onClear={() => { setProof(null); setDropProof(true); }} />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={busy || needBill}>{busy ? "Saving…" : needBill ? "Receipt photo needed" : entry ? "Save changes" : `Add ${type}`}</button>
        </div>
      </form>
    </Modal>
  );
}
