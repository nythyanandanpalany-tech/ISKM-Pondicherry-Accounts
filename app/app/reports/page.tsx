"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { inr } from "@/lib/format";
import type { Expense } from "@/lib/types";
import { useLookups } from "@/lib/useLookups";
import { input } from "@/components/ui";

function Bars({ title, data }: { title: string; data: [string, number][] }) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 font-semibold">{title}</div>
      {data.map(([k, v]) => (
        <div key={k} className="mb-2 text-sm">
          <div className="flex justify-between"><span>{k}</span><b>{inr(v)}</b></div>
          <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-indigo-500" style={{ width: `${(v / max) * 100}%` }} /></div>
        </div>
      ))}
      {!data.length && <div className="text-sm text-slate-400">No data</div>}
    </div>
  );
}

export default function Reports() {
  const { categories, accounts } = useLookups();
  const [rows, setRows] = useState<Expense[]>([]);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  useEffect(() => { supabase.from("expenses").select("*").neq("status", "rejected").then(({ data }) => setRows((data as Expense[]) ?? [])); }, []);
  const f = useMemo(() => rows.filter((r) => (!from || r.expense_date >= from) && (!to || r.expense_date <= to)), [rows, from, to]);
  const group = (key: (r: Expense) => string) => {
    const m = new Map<string, number>(); f.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + r.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Reports</h1>
      <div className="flex flex-wrap items-center gap-2 text-sm">From <input type="date" className={`${input} !w-auto`} value={from} onChange={(e) => setFrom(e.target.value)} />
        To <input type="date" className={`${input} !w-auto`} value={to} onChange={(e) => setTo(e.target.value)} />
        <span className="ml-auto text-lg font-bold">{inr(f.reduce((s, r) => s + r.amount, 0))}</span></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Bars title="By category" data={group((r) => categories.find((c) => c.id === r.category_id)?.name ?? "Uncategorised")} />
        <Bars title="By account" data={group((r) => accounts.find((c) => c.id === r.account_id)?.name ?? "Unassigned")} />
        <Bars title="By month" data={group((r) => r.expense_date.slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0]))} />
        <Bars title="Top vendors" data={group((r) => r.vendor || "—").slice(0, 8)} />
      </div>
    </div>
  );
}
