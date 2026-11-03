"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { db } from "@/lib/db";
import { dmy, today } from "@/lib/format";
import type { Entry } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { useWs } from "@/components/WorkspaceProvider";
import { btnGhost, input } from "@/components/ui";
import Gauge from "@/components/Gauge";

export default function Report() {
  const { advanced } = useAuth();
  const { ws, categories, canDownload, catName, itemName, personName, money } = useWs();
  const [date, setDate] = useState(today()); const [rows, setRows] = useState<Entry[]>([]); const [mrows, setMrows] = useState<Entry[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    db.from("entries").select("*").eq("workspace_id", ws.id).eq("entry_date", date).then(({ data }) => setRows((data as Entry[]) ?? []));
    db.from("entries").select("*").eq("workspace_id", ws.id).eq("type", "expense").gte("entry_date", date.slice(0, 7) + "-01").lte("entry_date", date).then(({ data }) => setMrows((data as Entry[]) ?? []));
  }, [ws.id, date]);
  const shift = (d: number) => setDate(new Date(new Date(date).getTime() + d * 86400000).toISOString().slice(0, 10));
  const exp = rows.filter((r) => r.type === "expense"), inc = rows.filter((r) => r.type === "income");
  const sum = (l: Entry[]) => l.reduce((s, r) => s + r.amount, 0);
  const byPerson = new Map<string, Entry[]>(); exp.forEach((r) => byPerson.set(r.person_id ?? "", [...(byPerson.get(r.person_id ?? "") ?? []), r]));
  async function png() { if (!ref.current) return; const url = await toPng(ref.current, { backgroundColor: "#fff", pixelRatio: 2 }); const a = document.createElement("a"); a.href = url; a.download = `report-${date}.png`; a.click(); }
  const reportText = () => `${ws.name} · ${dmy(date)}\nExpenses ${money(sum(exp))}\nIncome ${money(sum(inc))}\n` + exp.map((r) => `• ${catName(r.category_id)} ${itemName(r.item_id)} ${money(r.amount)}`).join("\n");
  async function share() {
    const text = reportText();
    if (navigator.share) navigator.share({ text }).catch(() => {}); else { await navigator.clipboard.writeText(text); alert("Report text copied."); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/app" className="text-sm text-indigo-600">← Dashboard</Link>
        <div className="flex items-center gap-2"><button className={btnGhost} onClick={() => shift(-1)}>‹</button><input type="date" className={`${input} !w-auto`} value={date} onChange={(e) => setDate(e.target.value)} /><button className={btnGhost} onClick={() => shift(1)}>›</button></div>
        <div className="flex gap-2">{canDownload && <button className={btnGhost} onClick={png}>PNG</button>}{advanced && canDownload && <button className={btnGhost} onClick={() => window.print()}>Print</button>}{advanced && <button className={btnGhost} onClick={async () => { await navigator.clipboard.writeText(reportText()); alert("Report text copied."); }}>Copy text</button>}<button className={btnGhost} onClick={share}>Share</button></div>
      </div>
      <div ref={ref} className="mx-auto max-w-2xl space-y-4 rounded-xl border bg-white p-6">
        <div className="text-center"><div className="text-lg font-bold">{ws.name}</div><div className="text-sm text-slate-500">Daily expense report · {dmy(date)}</div></div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded bg-slate-50 p-2">Expenses<br /><b>{money(sum(exp))}</b></div><div className="rounded bg-slate-50 p-2">Income<br /><b>{money(sum(inc))}</b></div><div className="rounded bg-slate-50 p-2">Entries<br /><b>{rows.length}</b></div></div>
        <div><div className="mb-1 font-semibold">I. Purchases</div>
          {[...byPerson.entries()].map(([p, l]) => (<div key={p} className="mb-2"><div className="text-sm font-medium text-indigo-700">{personName(p || null) || "Unassigned"} — {money(sum(l))}</div>
            {l.map((r) => <div key={r.id} className="flex justify-between border-b py-1 text-sm"><span>{catName(r.category_id)} {itemName(r.item_id) && `· ${itemName(r.item_id)}`} <span className="text-slate-400">{r.note}</span></span><span>{money(r.amount)}</span></div>)}</div>))}
          {!exp.length && <div className="text-sm text-slate-400">No expenses on this day.</div>}</div>
        {inc.length > 0 && <div><div className="mb-1 font-semibold">II. Income</div>{inc.map((r) => <div key={r.id} className="flex justify-between border-b py-1 text-sm"><span>{catName(r.category_id)} · {personName(r.person_id)} {r.reference_no && `(#${r.reference_no})`}</span><span>{money(r.amount)}</span></div>)}</div>}
        <div><div className="mb-2 font-semibold">III. Budget (month to date)</div><div className="space-y-2">
          {ws.monthly_budget && <Gauge label="Overall" spent={sum(mrows)} limit={ws.monthly_budget} money={money} />}
          {categories.filter((c) => c.monthly_limit).map((c) => <Gauge key={c.id} label={c.name} spent={sum(mrows.filter((r) => r.category_id === c.id))} limit={c.monthly_limit!} money={money} />)}</div></div>
      </div>
    </div>
  );
}
