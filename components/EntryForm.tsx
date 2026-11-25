"use client";
import { useEffect, useId, useState } from "react";
import { db } from "@/lib/db";
import { dmy, rupeesInWords, today } from "@/lib/format";
import { compressImage, MAX_PDF_MB, TARGET_KB } from "@/lib/compress";
import { MODES, type Entry } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { useWs } from "./WorkspaceProvider";
import { Modal, Receipt, btnGhost, btnPrimary, input } from "./ui";
import { CameraIcon, GalleryIcon, InflowIcon, OutflowIcon } from "./Icons";
import { Choice, hint, lbl, sec } from "./formKit";
import JournalForm from "./JournalForm";
import { VOUCHER_KINDS, voucherPreview } from "@/lib/voucher";
import { isCash } from "@/lib/accounts";

function FilePick({ title, note, required, file, existing, onFile, onClear }: {
  title: string; note: string; required?: boolean; file: File | null; existing: string | null; onFile: (f: File) => void; onClear: () => void;
}) {
  // One blob URL per chosen file, released when it changes. Minting it inline during render
  // leaked a URL on every keystroke elsewhere in the form, since any re-render made a new one.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const need = !!required && !file && !existing;
  const drop = `flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-xs font-medium transition focus-within:ring-2 focus-within:ring-indigo-500 ${
    need ? "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500" : "border-slate-300 bg-slate-50 text-slate-500 hover:border-indigo-400 hover:text-indigo-700"}`;
  const pick = (cls: string, text: string, icon?: React.ReactNode, cap?: boolean) => (
    <label className={cls}>{icon}<span>{text}</span>
      <input type="file" accept="image/*,application/pdf" capture={cap ? "environment" : undefined} className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
  return (
    <div className={`rounded-lg border p-3 ${need ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-slate-800">{title}{required && <span className="text-red-600" aria-hidden="true"> *</span>}</div>
        {need && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Needed</span>}
      </div>
      <p className={`mb-2.5 mt-0.5 ${hint}`}>{note}</p>
      {file ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" className="h-36 w-full rounded-md border border-slate-200 bg-slate-50 object-contain" />
            : <div className="flex h-36 items-center justify-center rounded-md border border-slate-200 bg-slate-50 p-3 text-center text-xs break-all text-slate-600">{file.name}</div>}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">{Math.max(1, Math.round(file.size / 1024))} KB{file.type.startsWith("image/") ? ` · shrunk to about ${TARGET_KB} KB when saved` : ""}</span>
            <button type="button" onClick={onClear} className="font-medium text-red-600 hover:underline">Remove</button>
          </div>
        </div>
      ) : existing ? (
        <div className="space-y-2">
          <Receipt path={existing} label="Current file" />
          <div className="flex gap-3 text-xs font-medium">
            {pick("cursor-pointer text-indigo-600 hover:underline focus-within:ring-2 focus-within:ring-indigo-500", "Replace")}
            <button type="button" onClick={onClear} className="text-red-600 hover:underline">Remove</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {pick(drop, "Take photo", <CameraIcon className="h-5 w-5" />, true)}
          {pick(drop, "From gallery", <GalleryIcon className="h-5 w-5" />)}
        </div>
      )}
    </div>
  );
}

type Props = { entry?: Entry; onClose: () => void; onSaved: () => void };

/** Expense / income, or — for whoever keeps the books — a journal voucher, which has a form of its own. */
export default function EntryForm(props: Props) {
  const [journal, setJournal] = useState(props.entry?.type === "journal");
  if (journal) return <JournalForm {...props} onBack={props.entry ? undefined : () => setJournal(false)} />;
  return <EntryFormBody {...props} onJournal={() => setJournal(true)} />;
}

function EntryFormBody({ entry, onClose, onSaved, onJournal }: Props & { onJournal: () => void }) {
  const { profile, advanced } = useAuth();
  const { ws, categories, items, people, banks, reload, catName, money, canAccount } = useWs();
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [type, setType] = useState<"expense" | "income">(entry?.type === "income" ? "income" : "expense");
  const [f, setF] = useState({
    entry_date: entry?.entry_date ?? today(), amount: entry?.amount?.toString() ?? "", category_id: entry?.category_id ?? "",
    item_id: entry?.item_id ?? "", person_id: entry?.person_id ?? "", payment_mode: entry?.payment_mode ?? "Cash",
    note: entry?.note ?? "", fund_source: entry?.fund_source ?? "", beneficiary: entry?.beneficiary ?? "", reference_no: entry?.reference_no ?? "", receipt_available: entry?.receipt_available ?? false,
    claim: !!entry?.claim_status, bank_account_id: entry?.bank_account_id ?? "", settles: entry?.settles_entry_id ?? "",
  });
  // Unpaid-bill journals this payment could clear (owners, admins and the main accountant; the database enforces that too).
  const [bills, setBills] = useState<{ id: string; label: string; left: number; cat: string | null }[]>([]);
  const [newPerson, setNewPerson] = useState("");
  const [proof, setProof] = useState<File | null>(null); const [bill, setBill] = useState<File | null>(null);
  const [dropProof, setDropProof] = useState(false); const [dropBill, setDropBill] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const cats = categories.filter((c) => c.kind === type);
  const its = items.filter((i) => i.category_id === f.category_id);
  const selectedCat = cats.find((c) => c.id === f.category_id);
  const isOther = selectedCat?.name === "Other" || selectedCat?.name === "Other Income";
  const hasBill = !!bill || (!!entry?.bill_path && !dropBill);
  const needBill = f.receipt_available && !hasBill;
  useEffect(() => {
    if (!canAccount || type !== "expense") return;
    let live = true;
    (async () => {
      const [j, p] = await Promise.all([
        db.from("entries").select("id, amount, entry_date, voucher_no, dr_category_id").eq("workspace_id", ws.id).eq("type", "journal").eq("jv_kind", "unpaid_bill"),
        db.from("entries").select("id, amount, settles_entry_id").eq("workspace_id", ws.id).not("settles_entry_id", "is", null),
      ]);
      if (!live) return;
      const paid = new Map<string, number>();
      // This entry's own earlier payment does not count against the bill it is being edited to settle.
      for (const x of (p.data as { id: string; amount: number; settles_entry_id: string }[]) ?? []) if (x.id !== entry?.id) paid.set(x.settles_entry_id, (paid.get(x.settles_entry_id) ?? 0) + Number(x.amount));
      setBills(((j.data as { id: string; amount: number; entry_date: string; voucher_no: string | null; dr_category_id: string | null }[]) ?? [])
        .map((x) => ({ id: x.id, left: Math.round((Number(x.amount) - (paid.get(x.id) ?? 0)) * 100) / 100, cat: x.dr_category_id, no: x.voucher_no, on: x.entry_date }))
        .filter((x) => x.left > 0.004 || x.id === entry?.settles_entry_id)
        .map((x) => ({ id: x.id, left: x.left, cat: x.cat, label: `${x.no ?? "Journal"} · ${dmy(x.on)} · ${catName(x.cat) || "—"} · ${money(x.left)} unpaid` })));
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccount, type, ws.id, entry?.id]);
  const digital = f.payment_mode === "UPI" || f.payment_mode === "Bank Transfer" || f.payment_mode === "Card";

  const amt = parseFloat(f.amount);
  const valid = Number.isFinite(amt) && amt > 0;
  // Only ₹ gets the words, since rupeesInWords names the unit itself.
  const words = valid && ws.currency === "₹" ? rupeesInWords(amt) : "";
  const preview = voucherPreview(type, f.payment_mode, f.entry_date, ws.vouchers_from);
  const viaBank = !isCash(f.payment_mode);
  const needBank = !!preview && viaBank && banks.length > 0 && !f.bank_account_id;
  const sameSeries = !!entry?.voucher_no && !!preview && entry.voucher_type === preview.kind && entry.voucher_fy === preview.series.split("/")[0] && entry.voucher_month === Number(f.entry_date.slice(5, 7));
  const summary = [valid ? money(amt) : null, catName(f.category_id) || null, f.payment_mode, f.entry_date ? dmy(f.entry_date) : null].filter(Boolean).join(" · ");

  async function upload(file: File) {
    if (file.type === "application/pdf" && file.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`PDF is over ${MAX_PDF_MB} MB. Please photograph the bill instead (photos are compressed automatically).`);
    const small = await compressImage(file);
    const ext = small.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${ws.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from("receipts").upload(path, small, { contentType: small.type });
    if (error) throw error;
    return path;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.entry_date) return setErr("Pick a date.");
    if (!f.amount.trim() || !valid) return setErr("Enter a valid amount greater than 0.");
    if (f.person_id === "__new" && !newPerson.trim()) return setErr(`Enter the new ${type === "expense" ? "payer's" : "sender's"} name, or pick someone from the list.`);
    if (needBill) return setErr("Attach the bill photo, or set “Receipt available” to No.");
    if (needBank) return setErr("Choose which bank account this went through.");
    if (isOther && !f.note.trim()) return setErr(type === "expense" ? "Please specify what this expense was for." : "Please specify what this income was from.");
    setBusy(true); setErr("");
    try {
      let person_id = f.person_id || null;
      if (person_id === "__new" && newPerson.trim()) {
        const { data, error } = await db.from("people").insert({ workspace_id: ws.id, name: newPerson.trim() }).select().single();
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
        bank_account_id: viaBank && f.bank_account_id ? f.bank_account_id : null, settles_entry_id: type === "expense" && f.settles ? f.settles : null,
        receipt_available: f.receipt_available, fund_source: f.fund_source.trim() || null, beneficiary: f.beneficiary.trim() || null, bill_path, payment_proof_path, claim_status,
      };
      const { error } = entry
        ? await db.from("entries").update(row).eq("id", entry.id)
        : await db.from("entries").insert({ ...row, workspace_id: ws.id, created_by: profile.id });
      if (error) throw error;
      if (stale.length) await db.storage.from("receipts").remove(stale);
      onSaved();
    } catch (ex) { setErr((ex as { message?: string })?.message ?? "Could not save"); } finally { setBusy(false); }
  }

  return (
    <Modal title={entry ? "Edit entry" : "Add entry"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-5">
        {/* Expense or income — the one choice that re-shapes everything below it, so it leads. */}
        <fieldset>
          <legend className="sr-only">Entry type</legend>
          <div className={`grid grid-cols-2 gap-2 ${canAccount && !entry ? "sm:max-w-xl sm:grid-cols-3" : "sm:max-w-md"}`}>
            {([["expense", "Expense", <OutflowIcon key="o" className="h-5 w-5" />], ["income", "Income", <InflowIcon key="i" className="h-5 w-5" />]] as const).map(([t, label, icon]) => (
              <Choice key={t} name={id("type")} checked={type === t} onSelect={() => { setType(t); setF({ ...f, category_id: "", item_id: "", claim: false }); }}>
                {icon}{label}
              </Choice>
            ))}
            {/* Owners, admins and the main accountant; a journal moves no cash or bank money, so it has its own form. */}
            {canAccount && !entry && (
              <Choice name={id("type")} checked={false} onSelect={onJournal}>Journal</Choice>
            )}
          </div>
          {/* Which voucher this becomes, so nobody has to know the CV / BV / CR / BR rule. */}
          <p className={`mt-2 ${hint}`} aria-live="polite">
            {preview
              ? sameSeries
                ? <>Voucher <span className="font-mono font-medium text-slate-700">{entry!.voucher_no}</span> · {VOUCHER_KINDS[preview.kind].label}</>
                : <>Recorded as a <b className="font-semibold text-slate-700">{VOUCHER_KINDS[preview.kind].label} ({preview.kind})</b>
                    {entry?.voucher_no ? <> — it will move from <span className="font-mono">{entry.voucher_no}</span> to a new number in the <span className="font-mono">{preview.series}</span> series.</> : <> — numbered <span className="font-mono">{preview.series}/V…</span> when saved.</>}</>
              : ws.vouchers_from ? <>Dated before {dmy(ws.vouchers_from)}, when voucher numbering starts — this entry gets no voucher number.</> : null}
          </p>
        </fieldset>

        <div className="grid gap-5 lg:grid-cols-5">
          {/* ---- Left: what it was, and how it was paid ---- */}
          <div className="space-y-5 lg:col-span-3">
            {/* The amount is the reason the dialog is open, so it is set at display size with the
                figure spelled out underneath — the same check a hand-written voucher carries. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
                <div>
                  <label htmlFor={id("amount")} className={lbl}>Amount<span className="text-red-600" aria-hidden="true"> *</span></label>
                  <div className="flex items-baseline gap-2">
                    <span aria-hidden="true" className="font-display text-2xl font-bold text-gold-ink">{ws.currency}</span>
                    <input id={id("amount")} className="w-full border-0 bg-transparent p-0 text-[30px] font-bold leading-tight text-slate-800 placeholder:text-slate-300 focus:outline-none"
                      type="number" step="0.01" min="0.01" placeholder="0.00" value={f.amount} onChange={set("amount")} required autoFocus aria-describedby={id("words")} />
                  </div>
                  <div id={id("words")} className="mt-1 min-h-4 text-xs text-slate-500">{words}</div>
                </div>
                <div>
                  <label htmlFor={id("date")} className={lbl}>Date<span className="text-red-600" aria-hidden="true"> *</span></label>
                  <input id={id("date")} className={input} type="date" value={f.entry_date} onChange={set("entry_date")} required />
                </div>
              </div>
            </div>

            <section className="space-y-3 border-t border-slate-200 pt-4">
              <h3 className={sec}>{type === "expense" ? "What it was for" : "Where it came from"}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={id("cat")} className={lbl}>{type === "expense" ? "Category" : "Income source"}</label>
                  <select id={id("cat")} className={input} value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value, item_id: "" })}>
                    <option value="">{type === "expense" ? "Select category" : "Select income source"}</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {isOther && (
                    <input className={`${input} mt-2`} aria-label={type === "expense" ? "What was this expense for?" : "What was this income from?"}
                      placeholder={type === "expense" ? "What was this expense for?" : "What was this income from?"} value={f.note} onChange={set("note")} required />
                  )}
                </div>
                <div>
                  <label htmlFor={id("item")} className={lbl}>{type === "expense" ? "Item" : "Detail"}</label>
                  <select id={id("item")} className={input} value={f.item_id} onChange={set("item_id")} disabled={!its.length}
                    aria-describedby={f.category_id && !its.length ? id("noitem") : undefined}>
                    <option value="">{its.length ? (type === "expense" ? "Select item" : "Select detail") : "No items"}</option>
                    {its.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {f.category_id && !its.length && <p id={id("noitem")} className={`mt-1 ${hint}`}>Nothing listed under this category yet — an admin can add items in Settings.</p>}
                </div>
              </div>
              {!isOther && (
                <div>
                  <label htmlFor={id("note")} className={lbl}>Note <span className="font-normal text-slate-400">(optional)</span></label>
                  <input id={id("note")} className={input} value={f.note} onChange={set("note")} placeholder="Anything worth remembering about this entry" />
                </div>
              )}
            </section>

            <section className="space-y-3 border-t border-slate-200 pt-4">
              <h3 className={sec}>How it was paid</h3>
              <fieldset>
                <legend className={lbl}>Payment mode</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {MODES.map((m) => <Choice key={m} name={id("mode")} checked={f.payment_mode === m} onSelect={() => setF({ ...f, payment_mode: m })}>{m}</Choice>)}
                </div>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={id("ref")} className={lbl}>{type === "income" ? "Reference No." : "UTR / transaction ID"}</label>
                  <input id={id("ref")} className={input} value={f.reference_no} onChange={set("reference_no")} aria-describedby={id("refhint")}
                    placeholder={digital ? "e.g. 412345678901" : type === "income" ? "Optional reference number" : "Optional"} />
                  <p id={id("refhint")} className={`mt-1 ${hint}`}>{type === "income" ? "The receipt number given to the donor, if any." : digital ? "Lets this entry be matched to the bank statement automatically." : "Only digital payments carry one."}</p>
                </div>
                <div>
                  <label htmlFor={id("person")} className={lbl}>{type === "expense" ? "Who paid" : "Received from"}</label>
                  <select id={id("person")} className={input} value={f.person_id} onChange={set("person_id")}>
                    <option value="">{type === "expense" ? "Select who paid" : "Select who it's from"}</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    <option value="__new">+ Add new name…</option>
                  </select>
                  {f.person_id === "__new" && <input className={`${input} mt-2`} aria-label="Full name" placeholder="Full name" value={newPerson} onChange={(e) => setNewPerson(e.target.value)} required />}
                </div>
              </div>
              {viaBank && banks.length > 0 && (
                <div>
                  <label htmlFor={id("bank")} className={lbl}>Bank account{preview && <span className="text-red-600" aria-hidden="true"> *</span>}</label>
                  <select id={id("bank")} className={input} value={f.bank_account_id} onChange={set("bank_account_id")}>
                    <option value="">{type === "expense" ? "Which bank was it paid from?" : "Which bank did it come into?"}</option>
                    {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              {type === "expense" && canAccount && (bills.length > 0 || !!f.settles) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <label htmlFor={id("settles")} className={lbl}>Does this pay a bill that was already booked as unpaid?</label>
                  <select id={id("settles")} className={input} value={f.settles} onChange={(e) => {
                    const b = bills.find((x) => x.id === e.target.value);
                    setF({ ...f, settles: e.target.value, ...(b ? { category_id: b.cat ?? f.category_id, amount: f.amount || String(b.left) } : {}) });
                  }}>
                    <option value="">No — an ordinary expense</option>
                    {bills.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                  <p className={`mt-1 ${hint}`}>{f.settles ? "The expense was charged when the bill was booked, so this payment only clears what is owed — it is not counted as an expense a second time." : "Choose one so the bill is not charged to expenses twice."}</p>
                </div>
              )}
              {type === "expense" && (
                <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition focus-within:ring-2 focus-within:ring-indigo-500 ${f.claim ? "border-indigo-600 bg-indigo-50" : "border-slate-300 hover:bg-hover"}`}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600" checked={f.claim} onChange={(e) => setF({ ...f, claim: e.target.checked })} />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">Paid from own pocket</span>
                    <span className={`block ${hint}`}>Claim reimbursement. The entry appears under Claims for an admin to approve and settle.</span>
                  </span>
                </label>
              )}
            </section>

            {advanced && (
              <section className="space-y-3 border-t border-slate-200 pt-4">
                <h3 className={sec}>Advanced</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label htmlFor={id("fund")} className={lbl}>Fund source</label><input id={id("fund")} className={input} value={f.fund_source} onChange={set("fund_source")} placeholder="e.g. Annadanam fund" /></div>
                  <div><label htmlFor={id("benef")} className={lbl}>Beneficiary</label><input id={id("benef")} className={input} value={f.beneficiary} onChange={set("beneficiary")} placeholder="who / what it benefits" /></div>
                </div>
              </section>
            )}
          </div>

          {/* ---- Right: the proof behind the rupee ---- */}
          <div className="space-y-3 border-t border-slate-200 pt-4 lg:col-span-2 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <h3 className={sec}>Proof</h3>
            <fieldset className={`rounded-lg border p-3 ${needBill ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
              <legend className="px-1 text-sm font-semibold text-slate-800">Receipt / bill available?</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {[true, false].map((v) => <Choice key={String(v)} name={id("rec")} checked={f.receipt_available === v} onSelect={() => setF({ ...f, receipt_available: v })}>{v ? "Yes" : "No"}</Choice>)}
              </div>
              <p className={`mt-2 ${needBill ? "text-xs text-amber-800" : hint}`}>
                {needBill ? "Attach the bill photo below, or answer “No” to save without one." : f.receipt_available ? "The bill photo below is required." : type === "expense" && !hasBill ? "Saving without a bill is allowed — it is kept as a self-voucher and marked “No bill”." : "Saving without a bill is allowed."}
              </p>
            </fieldset>
            <FilePick title="Bill / invoice photo" note="The bill this payment was made for. Photos are shrunk automatically to save space." required={f.receipt_available} file={bill}
              existing={dropBill ? null : entry?.bill_path ?? null} onFile={(x) => { setBill(x); setDropBill(false); }} onClear={() => { setBill(null); setDropBill(true); }} />
            <FilePick title="Payment screenshot" note="GPay / PhonePe / bank app screenshot. Used to match the bank statement." file={proof}
              existing={dropProof ? null : entry?.payment_proof_path ?? null} onFile={(x) => { setProof(x); setDropProof(false); }} onClear={() => { setProof(null); setDropProof(true); }} />
          </div>
        </div>

        {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

        {/* Stays in view while the form scrolls, so the figure being committed and the button
            that commits it are never on different screens. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-slate-200 bg-surface px-5 py-3">
          <p className="min-w-0 text-sm">
            <span className="text-slate-500">{type === "expense" ? "Expense" : "Income"}</span>
            {summary && <> · <span className="font-semibold text-slate-800">{summary}</span></>}
          </p>
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
            <button className={btnPrimary} disabled={busy || needBill}>{busy ? "Saving…" : needBill ? "Bill photo needed" : entry ? "Save changes" : `Add ${type}`}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
