"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy } from "@/lib/format";
import { toExcel, toCsv } from "@/lib/export";
import { MODES, type Entry } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { useWs } from "@/components/WorkspaceProvider";
import Vouchers from "@/components/Vouchers";
import EntryForm from "@/components/EntryForm";
import EntryDetail from "@/components/EntryDetail";
import { btnGhost, btnPrimary, input } from "@/components/ui";

const SORTS: Record<string, (a: Entry, b: Entry) => number> = {
  "Date: newest": (a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at),
  "Date: oldest": (a, b) => a.entry_date.localeCompare(b.entry_date),
  "Amount: small→big": (a, b) => a.amount - b.amount,
  "Amount: big→small": (a, b) => b.amount - a.amount,
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default function Ledger() {
  const { advanced } = useAuth();
  const { ws, categories, items, people, canWrite, canManage, canDownload, catName, itemName, personName, money } = useWs();
  const [rows, setRows] = useState<Entry[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""); const [period, setPeriod] = useState("month"); const [sort, setSort] = useState("Date: newest");
  const [showF, setShowF] = useState(false);
  const [fl, setFl] = useState({ from: "", to: "", category: "", item: "", person: "", mode: "", type: "", claim: "", gap: "", fund: "", benef: "" });
  const [vouchers, setVouchers] = useState(false);
  const [form, setForm] = useState<{ entry?: Entry } | null>(null); const [detail, setDetail] = useState<Entry | null>(null);

  const load = useCallback(async () => {
    const [e, t] = await Promise.all([
      supabase.from("entries").select("*").eq("workspace_id", ws.id).order("entry_date", { ascending: false }).limit(5000),
      canManage ? supabase.from("bank_transactions").select("matched_entry_id").eq("workspace_id", ws.id).not("matched_entry_id", "is", null) : Promise.resolve({ data: [] }),
    ]);
    setRows((e.data as Entry[]) ?? []);
    setMatched(new Set(((t.data as { matched_entry_id: string }[]) ?? []).map((x) => x.matched_entry_id)));
    setLoading(false);
  }, [ws.id, canManage]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const shown = useMemo(() => {
    const now = new Date(); const t0 = ymd(now); const wk = ymd(new Date(now.getTime() - 6 * 86400000)); const mo = t0.slice(0, 7);
    return rows.filter((r) => {
      if (period === "today" && r.entry_date !== t0) return false;
      if (period === "week" && r.entry_date < wk) return false;
      if (period === "month" && !r.entry_date.startsWith(mo)) return false;
      if (q && !`${r.note ?? ""} ${catName(r.category_id)} ${itemName(r.item_id)} ${personName(r.person_id)} ${r.reference_no ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (fl.from && r.entry_date < fl.from) return false; if (fl.to && r.entry_date > fl.to) return false;
      if (fl.category && r.category_id !== fl.category) return false; if (fl.item && r.item_id !== fl.item) return false;
      if (fl.person && r.person_id !== fl.person) return false; if (fl.mode && r.payment_mode !== fl.mode) return false;
      if (fl.type && r.type !== fl.type) return false;
      if (fl.fund && !(r.fund_source ?? "").toLowerCase().includes(fl.fund.toLowerCase())) return false;
      if (fl.benef && !(r.beneficiary ?? "").toLowerCase().includes(fl.benef.toLowerCase())) return false;
      if (fl.claim && (fl.claim === "none" ? r.claim_status : r.claim_status !== fl.claim)) return false;
      if (fl.gap === "nobill" && (r.bill_path || !r.receipt_available)) return false;
      if (fl.gap === "noproof" && (r.payment_proof_path || !["UPI", "Bank Transfer", "Card"].includes(r.payment_mode))) return false;
      if (fl.gap === "unmatched" && matched.has(r.id)) return false;
      return true;
    }).sort(SORTS[sort]);
  }, [rows, period, q, fl, sort, matched, catName, itemName, personName]);

  const exp = shown.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
  const inc = shown.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
  const chip = (id: string, label: string) => <button key={id} onClick={() => setPeriod(id)} className={`rounded-full px-3 py-1 text-sm ${period === id ? "bg-indigo-600 text-white" : "bg-white border text-slate-600"}`}>{label}</button>;
  const fset = (k: keyof typeof fl) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setFl({ ...fl, [k]: e.target.value });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Ledger</h1>
        <div className="flex gap-2">
          {canDownload && <button className={btnGhost} onClick={() => toExcel(shown, { cat: catName, item: itemName, person: personName })}>Excel</button>}
          {canDownload && <button className={btnGhost} onClick={() => window.print()}>PDF</button>}
          {canDownload && <button className={btnGhost} onClick={() => { if (!shown.some((r) => r.type === "expense" && !r.bill_path)) return alert("Every expense in this view already has a bill photo."); setVouchers(true); }}>Vouchers</button>}
          {canDownload && advanced && <button className={btnGhost} onClick={() => toCsv(shown, { cat: catName, item: itemName, person: personName })}>CSV</button>}
          {canWrite && <button className={btnPrimary} onClick={() => setForm({})}>+ Add entry</button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <input className={`${input} !w-full sm:!w-64`} placeholder="Search note, item, member…" value={q} onChange={(e) => setQ(e.target.value)} />
        {chip("today", "Today")}{chip("week", "7 days")}{chip("month", "This month")}{chip("all", "All")}
        <select className={`${input} !w-auto`} value={sort} onChange={(e) => setSort(e.target.value)}>{Object.keys(SORTS).map((s) => <option key={s}>{s}</option>)}</select>
        <button className={btnGhost} onClick={() => setShowF(!showF)}>Filters {showF ? "▲" : "▼"}</button>
      </div>
      {showF && (
        <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-4 print:hidden">
          <div><div className="text-xs text-slate-500">From</div><input type="date" className={input} value={fl.from} onChange={fset("from")} /></div>
          <div><div className="text-xs text-slate-500">To</div><input type="date" className={input} value={fl.to} onChange={fset("to")} /></div>
          <div><div className="text-xs text-slate-500">Category</div><select className={input} value={fl.category} onChange={fset("category")}><option value="">All</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><div className="text-xs text-slate-500">Item</div><select className={input} value={fl.item} onChange={fset("item")}><option value="">All</option>{items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><div className="text-xs text-slate-500">Member</div><select className={input} value={fl.person} onChange={fset("person")}><option value="">All</option>{people.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><div className="text-xs text-slate-500">Mode</div><select className={input} value={fl.mode} onChange={fset("mode")}><option value="">All</option>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div><div className="text-xs text-slate-500">Type</div><select className={input} value={fl.type} onChange={fset("type")}><option value="">All</option><option value="expense">Expense</option><option value="income">Income</option></select></div>
          <div><div className="text-xs text-slate-500">Claim status</div><select className={input} value={fl.claim} onChange={fset("claim")}><option value="">All</option><option value="none">Direct (no claim)</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="settled">Settled</option></select></div>
          <div className="sm:col-span-2"><div className="text-xs text-slate-500">Documents</div><select className={input} value={fl.gap} onChange={fset("gap")}>
            <option value="">All</option><option value="nobill">Bill photo missing</option><option value="noproof">Payment screenshot missing (UPI/bank)</option>{canManage && <option value="unmatched">Not matched to bank</option>}</select></div>
          {advanced && <div><div className="text-xs text-slate-500">Fund source</div><input className={input} value={fl.fund} onChange={fset("fund")} /></div>}
          {advanced && <div><div className="text-xs text-slate-500">Beneficiary</div><input className={input} value={fl.benef} onChange={fset("benef")} /></div>}
          <button className="text-sm text-indigo-600" onClick={() => setFl({ from: "", to: "", category: "", item: "", person: "", mode: "", type: "", claim: "", gap: "", fund: "", benef: "" })}>Clear</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Entries", String(shown.length)], ["Expenses", money(exp)], ["Income", money(inc)], ["Net", money(inc - exp)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-bold">{v}</div></div>))}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th>Category / Item</th><th>Member</th><th>Mode</th><th>Status</th><th className="text-right">Amount</th><th className="px-3">Bill</th><th>Payment</th>{canManage && <th>Bank</th>}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="p-6 text-center text-slate-400">Loading…</td></tr>}
            {!loading && !shown.length && <tr><td colSpan={9} className="p-6 text-center text-slate-400">No entries for these filters.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => setDetail(r)}>
                <td className="p-3 whitespace-nowrap">{dmy(r.entry_date)}</td>
                <td><div className="font-medium">{catName(r.category_id) || "—"}{r.item_id && ` · ${itemName(r.item_id)}`}</div><div className="text-xs text-slate-500">{r.note}</div></td>
                <td>{personName(r.person_id)}</td><td>{r.payment_mode}</td>
                <td className="text-xs capitalize">{r.claim_status ?? "direct"}</td>
                <td className={`text-right font-medium whitespace-nowrap ${r.type === "income" ? "text-emerald-600" : ""}`}>{r.type === "income" ? "+" : ""}{money(r.amount)}</td>
                <td className="px-3 text-center">{r.bill_path ? "✅" : r.receipt_available ? "⚠️" : "—"}</td>
                <td className="text-center">{r.payment_proof_path ? "✅" : ["UPI", "Bank Transfer", "Card"].includes(r.payment_mode) ? "⚠️" : "—"}</td>
                {canManage && <td className="text-center">{matched.has(r.id) ? "🔗" : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {vouchers && <Vouchers entries={shown.filter((r) => r.type === "expense" && !r.bill_path)} onClose={() => setVouchers(false)} />}
      {form && <EntryForm entry={form.entry} onClose={() => setForm(null)} onSaved={() => { setForm(null); setDetail(null); load(); }} />}
      {detail && !form && <EntryDetail entry={detail} onClose={() => setDetail(null)} onEdit={() => setForm({ entry: detail })} onChanged={() => { setDetail(null); load(); }} />}
    </div>
  );
}
