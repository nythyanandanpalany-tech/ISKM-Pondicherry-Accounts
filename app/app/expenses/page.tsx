"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy, inr } from "@/lib/format";
import type { Expense } from "@/lib/types";
import { useLookups } from "@/lib/useLookups";
import ExpenseForm from "@/components/ExpenseForm";
import ExpenseDetail from "@/components/ExpenseDetail";
import { StatusBadge, btnPrimary, btnGhost, input } from "@/components/ui";
import { useAuth } from "@/components/AuthProvider";

export default function Expenses() {
  const { isStaff } = useAuth();
  const { categories, accounts } = useLookups();
  const [rows, setRows] = useState<Expense[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [cat, setCat] = useState("");
  const [month, setMonth] = useState(""); const [flag, setFlag] = useState("");
  const [form, setForm] = useState<{ expense?: Expense } | null>(null);
  const [detail, setDetail] = useState<Expense | null>(null);

  const load = useCallback(async () => {
    const [e, t] = await Promise.all([
      supabase.from("expenses").select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false }),
      isStaff ? supabase.from("bank_transactions").select("matched_expense_id").not("matched_expense_id", "is", null) : Promise.resolve({ data: [] }),
    ]);
    setRows((e.data as Expense[]) ?? []);
    setMatched(new Set(((t.data as { matched_expense_id: string }[]) ?? []).map((x) => x.matched_expense_id)));
    setLoading(false);
  }, [isStaff]);
  useEffect(() => { load(); }, [load]);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "";
  const accName = (id: string | null) => accounts.find((c) => c.id === id)?.name ?? "";

  const shown = useMemo(() => rows.filter((r) => {
    if (q && !`${r.title} ${r.vendor ?? ""} ${r.utr ?? ""} ${r.notes ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (status && r.status !== status) return false;
    if (cat && r.category_id !== cat) return false;
    if (month && !r.expense_date.startsWith(month)) return false;
    if (flag === "nobill" && r.bill_path) return false;
    if (flag === "noproof" && r.payment_proof_path) return false;
    if (flag === "unmatched" && matched.has(r.id)) return false;
    return true;
  }), [rows, q, status, cat, month, flag, matched]);
  const total = shown.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Expenses</h1>
        <button className={btnPrimary} onClick={() => setForm({})}>+ Add expense</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        <input className={input} placeholder="Search title, vendor, UTR…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option>pending</option><option>approved</option><option>rejected</option></select>
        <select className={input} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className={input} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <select className={input} value={flag} onChange={(e) => setFlag(e.target.value)}>
          <option value="">All</option><option value="nobill">Bill missing</option><option value="noproof">Payment screenshot missing</option>
          {isStaff && <option value="unmatched">Not matched to bank</option>}</select>
      </div>
      <div className="text-sm text-slate-500">{shown.length} expenses · <b className="text-slate-800">{inr(total)}</b></div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="p-3">Date</th><th>Title</th><th>Category</th><th className="text-right">Amount</th><th className="px-3">Payment</th><th>Bill</th><th>Bank</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-6 text-center text-slate-400">Loading…</td></tr>}
            {!loading && !shown.length && <tr><td colSpan={8} className="p-6 text-center text-slate-400">No expenses found.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => setDetail(r)}>
                <td className="p-3 whitespace-nowrap">{dmy(r.expense_date)}</td>
                <td><div className="font-medium">{r.title}</div><div className="text-xs text-slate-500">{r.vendor}</div></td>
                <td>{catName(r.category_id)}</td>
                <td className="text-right font-medium whitespace-nowrap">{inr(r.amount)}</td>
                <td className="px-3 text-center">{r.payment_proof_path ? "✅" : "⚠️"}</td>
                <td className="text-center">{r.bill_path ? "✅" : "⚠️"}</td>
                <td className="text-center">{matched.has(r.id) ? "🔗" : "—"}</td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className={btnGhost} onClick={() => {
        const head = ["Date", "Title", "Vendor", "Category", "Account", "Amount", "UTR", "Status", "Payment screenshot", "Bill", "Matched to bank"];
        const lines = shown.map((r) => [r.expense_date, r.title, r.vendor ?? "", catName(r.category_id), accName(r.account_id), r.amount, r.utr ?? "", r.status, r.payment_proof_path ? "yes" : "no", r.bill_path ? "yes" : "no", matched.has(r.id) ? "yes" : "no"]);
        const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "expenses.csv"; a.click();
      }}>Export CSV</button>

      {form && <ExpenseForm expense={form.expense} categories={categories} accounts={accounts} onClose={() => setForm(null)} onSaved={() => { setForm(null); setDetail(null); load(); }} />}
      {detail && !form && <ExpenseDetail expense={detail} catName={catName(detail.category_id)} accName={accName(detail.account_id)}
        onClose={() => setDetail(null)} onEdit={() => setForm({ expense: detail })} onChanged={() => { setDetail(null); load(); }} />}
    </div>
  );
}
