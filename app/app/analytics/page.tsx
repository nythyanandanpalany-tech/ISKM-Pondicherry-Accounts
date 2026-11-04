"use client";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import { compact } from "@/lib/format";
import { useAuth } from "@/components/AuthProvider";
import type { Entry } from "@/lib/types";
import { useWs } from "@/components/WorkspaceProvider";
import { btnGhost, input } from "@/components/ui";

function Bars({ title, data, money, color = "bg-indigo-500" }: { title: string; data: [string, number][]; money: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  return (
    <div className="rounded-lg border border-slate-200 bg-surface shadow-card p-4"><div className="mb-3 font-semibold">{title}</div>
      {data.map(([k, v]) => (<div key={k} className="mb-2 text-sm"><div className="flex justify-between"><span>{k}</span><b>{money(v)}</b></div>
        <div className="h-2 rounded bg-slate-100"><div className={`h-2 rounded ${color}`} style={{ width: `${(v / max) * 100}%` }} /></div></div>))}
      {!data.length && <div className="text-sm text-slate-400">No data</div>}</div>
  );
}

export default function Analytics() {
  const { advanced } = useAuth();
  const { ws, canDownload, catName, itemName, personName, categories, money: exact } = useWs();
  const [fmt, setFmt] = useState<"exact" | "k">("exact");
  const money = (n: number) => (advanced && fmt === "k" ? `${ws.currency}${compact(n)}` : exact(n));
  const [rows, setRows] = useState<Entry[]>([]); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [cat, setCat] = useState("");
  useEffect(() => { db.from("entries").select("*").eq("workspace_id", ws.id).limit(5000).then(({ data }) => setRows((data as Entry[]) ?? [])); }, [ws.id]);
  const f = useMemo(() => rows.filter((r) => (!from || r.entry_date >= from) && (!to || r.entry_date <= to) && (!cat || r.category_id === cat)), [rows, from, to, cat]);
  const grp = (list: Entry[], key: (r: Entry) => string) => { const m = new Map<string, number>(); list.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + r.amount)); return [...m.entries()]; };
  const exp = f.filter((r) => r.type === "expense"), inc = f.filter((r) => r.type === "income");
  const sum = (l: Entry[]) => l.reduce((s, r) => s + r.amount, 0);
  const top = (l: [string, number][], n = 8) => l.sort((a, b) => b[1] - a[1]).slice(0, n);
  const months = [...new Set(f.map((r) => r.entry_date.slice(0, 7)))].sort();
  return (
    <div className="space-y-4" id="analytics">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-[24px] font-bold text-slate-800">Analytics</h1><div className="flex gap-2">{advanced && <select className={`${input} !w-auto`} value={fmt} onChange={(e) => setFmt(e.target.value as "exact" | "k")}><option value="exact">Exact</option><option value="k">Formatted (k / L / Cr)</option></select>}{canDownload && <button className={btnGhost} onClick={() => window.print()}>PDF</button>}</div></div>
      <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">From <input type="date" className={`${input} !w-auto`} value={from} onChange={(e) => setFrom(e.target.value)} />
        To <input type="date" className={`${input} !w-auto`} value={to} onChange={(e) => setTo(e.target.value)} />
        <select className={`${input} !w-auto`} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="grid grid-cols-3 gap-3">{[["Expenses", sum(exp)], ["Income", sum(inc)], ["Net", sum(inc) - sum(exp)]].map(([k, v]) => <div key={k as string} className="rounded-lg border border-slate-200 bg-surface shadow-card p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-bold">{money(v as number)}</div></div>)}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <Bars title="Income vs expense by month" money={money} data={months.flatMap((m) => [[`${m} · expense`, sum(exp.filter((r) => r.entry_date.startsWith(m)))], [`${m} · income`, sum(inc.filter((r) => r.entry_date.startsWith(m)))]] as [string, number][])} />
        <Bars title="Daily spending (latest 14 days)" money={money} data={grp(exp, (r) => r.entry_date).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)} />
        <Bars title="Spending by category" money={money} data={top(grp(exp, (r) => catName(r.category_id) || "Uncategorised"))} />
        <Bars title="Top items" money={money} data={top(grp(exp.filter((r) => r.item_id), (r) => itemName(r.item_id)))} />
        <Bars title="Member-wise paid" money={money} data={top(grp(exp, (r) => personName(r.person_id) || "—"))} />
        <Bars title="Member-wise received" money={money} color="bg-emerald-500" data={top(grp(inc, (r) => personName(r.person_id) || "—"))} />
      </div>
    </div>
  );
}
