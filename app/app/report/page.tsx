"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { dmy, today } from "@/lib/format";
import type { Entry } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { useWs } from "@/components/WorkspaceProvider";
import { btnGhost, input } from "@/components/ui";
import Gauge from "@/components/Gauge";
import { brand } from "@/lib/brand";
import { LotusMark } from "@/components/Brand";

export default function Report() {
  const { advanced } = useAuth();
  const { ws, categories, canDownload, catName, itemName, personName, money } = useWs();
  const [date, setDate] = useState(today()); const [rows, setRows] = useState<Entry[]>([]); const [mrows, setMrows] = useState<Entry[]>([]);
  const [notice, setNote] = useState<{ text: string; bad?: boolean } | null>(null); const [building, setBuilding] = useState(false);
  useEffect(() => {
    db.from("entries").select("*").eq("workspace_id", ws.id).eq("entry_date", date).then(({ data }) => setRows((data as Entry[]) ?? []));
    db.from("entries").select("*").eq("workspace_id", ws.id).eq("type", "expense").gte("entry_date", date.slice(0, 7) + "-01").lte("entry_date", date).then(({ data }) => setMrows((data as Entry[]) ?? []));
  }, [ws.id, date]);
  const shift = (d: number) => setDate(new Date(new Date(date).getTime() + d * 86400000).toISOString().slice(0, 10));
  const exp = rows.filter((r) => r.type === "expense"), inc = rows.filter((r) => r.type === "income");
  const sum = (l: Entry[]) => l.reduce((s, r) => s + r.amount, 0);
  const byPerson = new Map<string, Entry[]>(); exp.forEach((r) => byPerson.set(r.person_id ?? "", [...(byPerson.get(r.person_id ?? "") ?? []), r]));
  // One list, drawn as gauges on screen and as bars in the PDF, so the two cannot drift apart.
  const budget = [
    ...(ws.monthly_budget ? [{ id: "overall", label: "Overall", spent: sum(mrows), limit: ws.monthly_budget }] : []),
    ...categories.filter((c) => c.monthly_limit).map((c) => ({ id: c.id, label: c.name, spent: sum(mrows.filter((r) => r.category_id === c.id)), limit: c.monthly_limit! })),
  ];
  // jsPDF and the embedded faces are a few hundred kB, so they load on the click, not on the page.
  async function pdf() {
    setBuilding(true); setNote(null);
    try {
      const { downloadReportPdf, reportFileName } = await import("@/lib/pdf");
      await downloadReportPdf({ date, workspace: ws.name, expenses: exp, income: inc, budget, money, names: { cat: catName, item: itemName, person: personName } });
      setNote({ text: `Saved ${reportFileName(date)}.` });
    } catch (e) {
      setNote({ text: `Could not build the PDF: ${e instanceof Error ? e.message : "unknown error"}. Please try again.`, bad: true });
    } finally { setBuilding(false); }
  }
  const reportText = () => `${brand.greeting} 🙏\n${brand.name} · ${ws.name}\nDaily seva report · ${dmy(date)}\n\nExpenses ${money(sum(exp))}\nIncome ${money(sum(inc))}\n` + exp.map((r) => `• ${catName(r.category_id)} ${itemName(r.item_id)} ${money(r.amount)}`).join("\n");
  async function share() {
    const text = reportText();
    if (navigator.share) navigator.share({ text }).catch(() => {}); else { await navigator.clipboard.writeText(text); setNote({ text: "Report text copied to the clipboard." }); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/app" className="text-sm text-indigo-600">← Dashboard</Link>
        <div className="flex items-center gap-2"><button className={btnGhost} onClick={() => shift(-1)}>‹</button><input type="date" className={`${input} !w-auto`} value={date} onChange={(e) => setDate(e.target.value)} /><button className={btnGhost} onClick={() => shift(1)}>›</button></div>
        <div className="flex gap-2">{canDownload && <button className={btnGhost} onClick={pdf} disabled={building}>{building ? "Building PDF…" : "Download PDF"}</button>}{advanced && canDownload && <button className={btnGhost} onClick={() => window.print()}>Print</button>}{advanced && <button className={btnGhost} onClick={async () => { await navigator.clipboard.writeText(reportText()); alert("Report text copied."); }}>Copy text</button>}<button className={btnGhost} onClick={share}>Share</button></div>
      </div>
      {notice && <p role="status" className={`rounded-md border p-2 text-sm print:hidden ${notice.bad ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{notice.text}</p>}
      <div className="mx-auto max-w-2xl space-y-4 rounded-lg border border-slate-200 bg-surface shadow-card p-6">
        <header className="text-center">
          <div className="text-[11px] tracking-[0.3em] text-gold" lang="sa">॥ हरे कृष्ण ॥</div>
          <div className="mt-1.5 flex items-center justify-center gap-2.5">
            <LotusMark size={32} print />
            <div className="text-left">
              <div className="font-display text-[17px] font-bold leading-tight text-slate-800">{brand.legalName}</div>
              {brand.address && <div className="text-[11px] text-slate-500">{brand.address}</div>}
            </div>
          </div>
          <div className="my-3 h-px" style={{ backgroundColor: "#b8912a", opacity: 0.6 }} />
          <div className="text-sm font-medium text-slate-700">{ws.name}</div>
          <div className="text-xs text-slate-500">Daily seva report · {dmy(date)}</div>
        </header>
        <div className="grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded bg-slate-50 p-2">Expenses<br /><b>{money(sum(exp))}</b></div><div className="rounded bg-slate-50 p-2">Income<br /><b>{money(sum(inc))}</b></div><div className="rounded bg-slate-50 p-2">Entries<br /><b>{rows.length}</b></div></div>
        <div><div className="mb-1 font-display font-bold text-slate-800">I. Purchases</div>
          {[...byPerson.entries()].map(([p, l]) => (<div key={p} className="mb-2"><div className="text-sm font-medium text-indigo-700">{personName(p || null) || "Unassigned"} — {money(sum(l))}</div>
            {l.map((r) => <div key={r.id} className="flex justify-between border-b py-1 text-sm"><span>{catName(r.category_id)} {itemName(r.item_id) && `· ${itemName(r.item_id)}`} <span className="text-slate-400">{r.note}</span></span><span>{money(r.amount)}</span></div>)}</div>))}
          {!exp.length && <div className="text-sm text-slate-400">No expenses on this day.</div>}</div>
        {inc.length > 0 && <div><div className="mb-1 font-display font-bold text-slate-800">II. Income</div>{inc.map((r) => <div key={r.id} className="flex justify-between border-b py-1 text-sm"><span>{catName(r.category_id)} · {personName(r.person_id)} {r.reference_no && `(#${r.reference_no})`}</span><span>{money(r.amount)}</span></div>)}</div>}
        <div><div className="mb-2 font-display font-bold text-slate-800">III. Budget (month to date)</div><div className="space-y-2">
          {budget.map((b) => <Gauge key={b.id} label={b.label} spent={b.spent} limit={b.limit} money={money} />)}</div></div>
        <footer className="pt-2 text-center text-[10px] tracking-wider text-slate-400">
          {brand.legalName} · {brand.app} · all glories to Śrīla Prabhupāda
        </footer>
      </div>
    </div>
  );
}
