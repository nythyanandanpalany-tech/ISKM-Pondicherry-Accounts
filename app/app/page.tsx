"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy } from "@/lib/format";
import type { Entry } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { useWs } from "@/components/WorkspaceProvider";
import EntryForm from "@/components/EntryForm";
import { btnGhost, btnPrimary } from "@/components/ui";
import { toExcel } from "@/lib/export";
import Gauge from "@/components/Gauge";
import StorageMeter, { FREE_BYTES, useStorageUsage } from "@/components/StorageMeter";

export default function Dashboard() {
  const { profile, advanced } = useAuth();
  const { ws, categories, items, canWrite, canManage, canDownload, catName, itemName, personName, money } = useWs();
  const storageUsed = useStorageUsage(canManage);
  const [rows, setRows] = useState<Entry[]>([]); const [open, setOpen] = useState(false); const [unmatched, setUnmatched] = useState(0); const [more, setMore] = useState(15);
  const load = () => {
    supabase.from("entries").select("*").eq("workspace_id", ws.id).order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000).then(({ data }) => setRows((data as Entry[]) ?? []));
    if (canManage) supabase.from("bank_transactions").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).is("matched_entry_id", null).then(({ count }) => setUnmatched(count ?? 0));
  };
  useEffect(load, [ws.id, canManage]);

  const t0 = new Date().toISOString().slice(0, 10); const mo = t0.slice(0, 7);
  const sum = (f: (e: Entry) => boolean) => rows.filter(f).reduce((s, e) => s + e.amount, 0);
  const monthExp = rows.filter((e) => e.type === "expense" && e.entry_date.startsWith(mo));
  const spentBy = (key: "category_id" | "item_id", id: string) => monthExp.filter((e) => e[key] === id).reduce((s, e) => s + e.amount, 0);
  const gauges = [
    ...(ws.monthly_budget ? [{ label: "Overall monthly budget", spent: monthExp.reduce((s, e) => s + e.amount, 0), limit: ws.monthly_budget }] : []),
    ...categories.filter((c) => c.monthly_limit).map((c) => ({ label: c.name, spent: spentBy("category_id", c.id), limit: c.monthly_limit! })),
    ...items.filter((c) => c.monthly_limit).map((c) => ({ label: `${catName(c.category_id)} · ${c.name}`, spent: spentBy("item_id", c.id), limit: c.monthly_limit! })),
  ];
  const cards: [string, string, string?][] = [
    ["Today · expenses", money(sum((e) => e.type === "expense" && e.entry_date === t0))],
    ["Month expenses", money(sum((e) => e.type === "expense" && e.entry_date.startsWith(mo)))],
    ["Month income", money(sum((e) => e.type === "income" && e.entry_date.startsWith(mo)))],
    ["Pending settlement", money(sum((e) => e.claim_status === "submitted" || e.claim_status === "approved")), "/app/claims"],
    ["Bills missing", String(rows.filter((e) => e.receipt_available && !e.bill_path).length), "/app/ledger"],
    ...(canManage ? [["Bank rows to match", String(unmatched), "/app/reconcile"] as [string, string, string]] : []),
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Hare Krishna, {profile.full_name} 🙏</h1>
        <div className="flex gap-2"><Link href="/app/report" className={btnGhost}>Report</Link>{canWrite && <button className={btnPrimary} onClick={() => setOpen(true)}>+ Add entry</button>}</div>
      </div>
      {canManage && storageUsed != null && storageUsed >= FREE_BYTES * 0.75 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3"><StorageMeter used={storageUsed} /></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(([t, v, href]) => { const c = <div className="h-full rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{t}</div><div className="mt-1 text-lg font-bold">{v}</div></div>; return href ? <Link key={t} href={href}>{c}</Link> : <div key={t}>{c}</div>; })}
      </div>
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between font-semibold">Budget &amp; item limits {canManage && <Link href="/app/settings" className="text-sm font-normal text-indigo-600">Configure</Link>}</div>
        <div className="space-y-3">{gauges.map((g) => <Gauge key={g.label} {...g} money={money} />)}
          {!gauges.length && <div className="text-sm text-slate-400">No limits set. {canManage ? "Set a monthly budget or category limits in Settings." : ""}</div>}</div>
      </div>
      <div className="rounded-xl border bg-white">
        <div className="flex items-center justify-between border-b p-3 font-semibold">Recent activity <span className="flex items-center gap-3 text-sm font-normal">{advanced && canDownload && <button className="text-indigo-600" onClick={() => toExcel(rows.slice(0, more), { cat: catName, item: itemName, person: personName }, "recent.xlsx")}>Excel</button>}{advanced && canWrite && <button className="text-indigo-600" onClick={() => setOpen(true)}>Add</button>}<Link href="/app/ledger" className="text-indigo-600">Ledger</Link></span></div>
        {rows.slice(0, more).map((r) => (
          <div key={r.id} className="flex items-center justify-between border-b p-3 text-sm last:border-0">
            <div><div className="font-medium">{catName(r.category_id) || r.type}{r.item_id && ` · ${itemName(r.item_id)}`}</div>
              <div className="text-xs text-slate-500">{dmy(r.entry_date)} · {personName(r.person_id)} · {r.payment_mode}{r.note && ` · ${r.note}`}</div></div>
            <b className={r.type === "income" ? "text-emerald-600" : ""}>{r.type === "income" ? "+" : ""}{money(r.amount)}</b>
          </div>))}
        {!rows.length && <div className="p-6 text-center text-sm text-slate-400">No entries yet.</div>}
        {rows.length > more && <button className="w-full p-3 text-sm text-indigo-600" onClick={() => setMore(more + 15)}>Show 15 more</button>}
      </div>
      {open && <EntryForm onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} />}
    </div>
  );
}
