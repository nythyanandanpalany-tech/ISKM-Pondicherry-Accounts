"use client";
import { useId, useState } from "react";
import { db } from "@/lib/db";
import { dmy, rupeesInWords, today } from "@/lib/format";
import type { Entry } from "@/lib/types";
import { JV_KINDS, VOUCHER_KINDS, voucherPreview, type JvKind } from "@/lib/voucher";
import { useAuth } from "./AuthProvider";
import { useWs } from "./WorkspaceProvider";
import { Modal, btnGhost, btnPrimary, input } from "./ui";
import { Choice, hint, lbl, sec } from "./formKit";

const KINDS = Object.keys(JV_KINDS) as JvKind[];

/**
 * Journal voucher (JV): an adjustment where no cash or bank money moves — a bill not yet paid,
 * an amount moved between heads, or a mistake corrected. Owners and admins only; the database
 * enforces that (row level security), this form just does not offer it to anyone else.
 */
export default function JournalForm({ entry, onClose, onSaved, onBack }: { entry?: Entry; onClose: () => void; onSaved: () => void; onBack?: () => void }) {
  const { profile } = useAuth();
  const { ws, categories, money } = useWs();
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [f, setF] = useState({
    entry_date: entry?.entry_date ?? today(), amount: entry?.amount?.toString() ?? "",
    jv_kind: (entry?.jv_kind ?? "unpaid_bill") as JvKind, dr: entry?.dr_category_id ?? "", cr: entry?.cr_category_id ?? "", note: entry?.note ?? "",
  });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const unpaid = f.jv_kind === "unpaid_bill";
  const expenseHeads = categories.filter((c) => c.kind === "expense");
  const incomeHeads = categories.filter((c) => c.kind === "income");
  const amt = parseFloat(f.amount); const valid = Number.isFinite(amt) && amt > 0;
  const words = valid && ws.currency === "₹" ? rupeesInWords(amt) : "";
  const preview = voucherPreview("journal", "Journal", f.entry_date, ws.vouchers_from);
  const sameSeries = !!entry?.voucher_no && !!preview && entry.voucher_fy === preview.series.split("/")[0] && entry.voucher_month === Number(f.entry_date.slice(5, 7));

  const heads = (value: string, onChange: (v: string) => void, label: string, only?: "expense") => (
    <div>
      <label htmlFor={id(label)} className={lbl}>{label === "dr" ? "Debit (the head that gains)" : "Credit (the head that gives)"}<span className="text-red-600" aria-hidden="true"> *</span></label>
      <select id={id(label)} className={input} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Select head</option>
        <optgroup label="Expense heads">{expenseHeads.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
        {!only && <optgroup label="Income heads">{incomeHeads.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
      </select>
    </div>
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.entry_date) return setErr("Pick a date.");
    if (!preview) return setErr(ws.vouchers_from ? `Journal vouchers are numbered from ${dmy(ws.vouchers_from)}. Pick a date on or after it.` : "Voucher numbering is switched off for this workspace.");
    if (!valid) return setErr("Enter a valid amount greater than 0.");
    if (!f.dr) return setErr("Choose the head to debit.");
    if (!unpaid && !f.cr) return setErr("Choose the head to credit.");
    if (!unpaid && f.cr === f.dr) return setErr("The debit and credit heads must be different.");
    if (!f.note.trim()) return setErr("Write a short narration — why is this journal being made?");
    setBusy(true); setErr("");
    const row = {
      type: "journal" as const, entry_date: f.entry_date, amount: amt, payment_mode: "Journal", note: f.note.trim(),
      jv_kind: f.jv_kind, dr_category_id: f.dr, cr_category_id: unpaid ? null : f.cr,
      category_id: null, item_id: null, person_id: null, reference_no: null, receipt_available: false,
      fund_source: null, beneficiary: null, bill_path: null, payment_proof_path: null, claim_status: null,
    };
    const { error } = entry
      ? await db.from("entries").update(row).eq("id", entry.id)
      : await db.from("entries").insert({ ...row, workspace_id: ws.id, created_by: profile.id });
    setBusy(false);
    if (error) return setErr(error.message);
    onSaved();
  }

  return (
    <Modal title={entry ? "Edit journal voucher" : "New journal voucher"} onClose={onClose}>
      <form onSubmit={save} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {VOUCHER_KINDS.JV.label}s record an adjustment where <b className="font-semibold text-slate-700">no cash or bank money moves</b>.
          <p className={`mt-1.5 ${hint}`} aria-live="polite">
            {preview
              ? sameSeries
                ? <>Voucher <span className="font-mono font-medium text-slate-700">{entry!.voucher_no}</span></>
                : <>Numbered <span className="font-mono">{preview.series}/V…</span> when saved.</>
              : ws.vouchers_from ? <>Dated before {dmy(ws.vouchers_from)}, when voucher numbering starts — pick a later date.</> : "Voucher numbering is switched off for this workspace."}
          </p>
        </div>

        <fieldset>
          <legend className={`${sec} mb-2`}>What is this journal for?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => <Choice key={k} name={id("kind")} checked={f.jv_kind === k} onSelect={() => setF({ ...f, jv_kind: k, cr: k === "unpaid_bill" ? "" : f.cr, dr: k === "unpaid_bill" && !expenseHeads.some((c) => c.id === f.dr) ? "" : f.dr })}>{JV_KINDS[k].label}</Choice>)}
          </div>
          <p className={`mt-2 ${hint}`}>{JV_KINDS[f.jv_kind].hint}</p>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
          <div>
            <label htmlFor={id("amount")} className={lbl}>Amount<span className="text-red-600" aria-hidden="true"> *</span></label>
            <div className="flex items-baseline gap-2">
              <span aria-hidden="true" className="font-display text-xl font-bold text-gold-ink">{ws.currency}</span>
              <input id={id("amount")} className={input} type="number" step="0.01" min="0.01" placeholder="0.00" value={f.amount} onChange={set("amount")} required autoFocus aria-describedby={id("words")} />
            </div>
            <div id={id("words")} className="mt-1 min-h-4 text-xs text-slate-500">{words}</div>
          </div>
          <div>
            <label htmlFor={id("date")} className={lbl}>Date<span className="text-red-600" aria-hidden="true"> *</span></label>
            <input id={id("date")} className={input} type="date" value={f.entry_date} onChange={set("entry_date")} required />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {heads(f.dr, (v) => setF({ ...f, dr: v }), "dr", unpaid ? "expense" : undefined)}
          {unpaid
            ? <div>
                <div className={lbl}>Credit (the head that gives)</div>
                <div className="flex min-h-11 items-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 text-sm text-slate-600">Outstanding expenses</div>
                <p className={`mt-1 ${hint}`}>Money still owed for the bill.</p>
              </div>
            : heads(f.cr, (v) => setF({ ...f, cr: v }), "cr")}
        </div>

        <div>
          <label htmlFor={id("note")} className={lbl}>Narration<span className="text-red-600" aria-hidden="true"> *</span></label>
          <textarea id={id("note")} className={input} rows={2} value={f.note} onChange={set("note")} required
            placeholder={unpaid ? "e.g. Electricity bill for October, to be paid next week" : "e.g. Booked to Gaushala by mistake; belongs to Festival"} />
        </div>

        {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <p className="min-w-0 text-sm text-slate-500">{valid ? <span className="font-semibold text-slate-800">{money(amt)}</span> : "Journal"}{f.entry_date && ` · ${dmy(f.entry_date)}`}</p>
          <div className="flex gap-2">
            {onBack && <button type="button" className={btnGhost} onClick={onBack}>← Expense / income</button>}
            <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
            <button className={btnPrimary} disabled={busy}>{busy ? "Saving…" : entry ? "Save changes" : "Add journal voucher"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
