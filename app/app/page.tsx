"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { dmy } from "@/lib/format";
import type { Entry } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { useWs } from "@/components/WorkspaceProvider";
import EntryForm from "@/components/EntryForm";
import EntryDetail from "@/components/EntryDetail";
import { btnGhost, btnPrimary, rowActivate, rowClickable } from "@/components/ui";
import { toExcel } from "@/lib/export";
import Gauge from "@/components/Gauge";
import StorageMeter, { FREE_BYTES, useStorageUsage } from "@/components/StorageMeter";
import CashflowChart from "@/components/CashflowChart";
import { VerseOfTheDay } from "@/components/Verse";
import { brand } from "@/lib/brand";
import { BankIcon, InflowIcon, OutflowIcon, PendingIcon, ReceiptIcon, RupeeIcon } from "@/components/Icons";

type Card = { label: string; value: string; href?: string; icon: React.ReactNode; trend?: { pct: number; good: boolean } };

/** Today's date in words. Mounted client-side so the server's timezone can't
    disagree with the devotee's during hydration. */
function TodayLine({ workspace }: { workspace: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })), []);
  return <p className="mt-1 text-sm text-slate-500">{label}{label && " · "}{workspace}</p>;
}

export default function Dashboard() {
  const { profile, advanced } = useAuth();
  const { ws, categories, items, canWrite, canManage, canDownload, catName, itemName, personName, money } = useWs();
  const storageUsed = useStorageUsage(canManage);
  const [rows, setRows] = useState<Entry[]>([]); const [unmatched, setUnmatched] = useState(0); const [more, setMore] = useState(15);
  const [form, setForm] = useState<{ entry?: Entry } | null>(null); const [detail, setDetail] = useState<Entry | null>(null);
  const load = () => {
    db.from("entries").select("*").eq("workspace_id", ws.id).order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000).then(({ data }) => setRows((data as Entry[]) ?? []));
    if (canManage) db.from("bank_transactions").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).is("matched_entry_id", null).then(({ count }) => setUnmatched(count ?? 0));
  };
  useEffect(load, [ws.id, canManage]);

  const t0 = new Date().toISOString().slice(0, 10); const mo = t0.slice(0, 7);
  const [moY, moM] = mo.split("-").map(Number);
  const lastMoDate = new Date(moY, moM - 2, 1); const lastMo = `${lastMoDate.getFullYear()}-${String(lastMoDate.getMonth() + 1).padStart(2, "0")}`;
  const sum = (f: (e: Entry) => boolean) => rows.filter(f).reduce((s, e) => s + e.amount, 0);
  const monthExp = rows.filter((e) => e.type === "expense" && e.entry_date.startsWith(mo));
  const spentBy = (key: "category_id" | "item_id", id: string) => monthExp.filter((e) => e[key] === id).reduce((s, e) => s + e.amount, 0);
  const thisMoExp = sum((e) => e.type === "expense" && e.entry_date.startsWith(mo));
  const thisMoInc = sum((e) => e.type === "income" && e.entry_date.startsWith(mo));
  const lastMoExp = sum((e) => e.type === "expense" && e.entry_date.startsWith(lastMo));
  const lastMoInc = sum((e) => e.type === "income" && e.entry_date.startsWith(lastMo));
  const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
  const expTrend = pct(thisMoExp, lastMoExp); const incTrend = pct(thisMoInc, lastMoInc);

  const gauges = [
    ...(ws.monthly_budget ? [{ label: "Overall monthly budget", spent: monthExp.reduce((s, e) => s + e.amount, 0), limit: ws.monthly_budget }] : []),
    ...categories.filter((c) => c.monthly_limit).map((c) => ({ label: c.name, spent: spentBy("category_id", c.id), limit: c.monthly_limit! })),
    ...items.filter((c) => c.monthly_limit).map((c) => ({ label: `${catName(c.category_id)} · ${c.name}`, spent: spentBy("item_id", c.id), limit: c.monthly_limit! })),
  ];
  const topSpending = categories.filter((c) => c.kind === "expense")
    .map((c) => ({ c, amt: spentBy("category_id", c.id), n: monthExp.filter((e) => e.category_id === c.id).length }))
    .filter((x) => x.amt > 0).sort((a, b) => b.amt - a.amt).slice(0, 3);

  const cards: Card[] = [
    { label: "Today · expenses", value: money(sum((e) => e.type === "expense" && e.entry_date === t0)), icon: <RupeeIcon /> },
    { label: "Month expenses", value: money(thisMoExp), icon: <OutflowIcon />, trend: expTrend != null ? { pct: expTrend, good: expTrend <= 0 } : undefined },
    { label: "Month income", value: money(thisMoInc), icon: <InflowIcon />, trend: incTrend != null ? { pct: incTrend, good: incTrend >= 0 } : undefined },
    { label: "Pending settlement", value: money(sum((e) => e.claim_status === "submitted" || e.claim_status === "approved")), href: "/app/claims", icon: <PendingIcon /> },
    { label: "Bills missing", value: String(rows.filter((e) => e.receipt_available && !e.bill_path).length), href: "/app/ledger", icon: <ReceiptIcon /> },
    ...(canManage ? [{ label: "Bank rows to match", value: String(unmatched), href: "/app/reconcile", icon: <BankIcon /> } as Card] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-bold text-slate-800">{brand.greeting}, {profile.full_name} 🙏</h1>
          <TodayLine workspace={ws.name} />
        </div>
        <div className="flex gap-2"><Link href="/app/report" className={btnGhost}>Report</Link>{canWrite && <button className={btnPrimary} onClick={() => setForm({})}>+ Add entry</button>}</div>
      </div>
      <VerseOfTheDay />
      {canManage && storageUsed != null && storageUsed >= FREE_BYTES * 0.75 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3"><StorageMeter used={storageUsed} /></div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => {
          const body = (
            <div className="h-full rounded-lg border border-slate-200 bg-surface p-4 shadow-card transition hover:shadow-hover-card">
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">{c.icon}</span>
                {c.trend && <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${c.trend.good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{c.trend.pct > 0 ? "+" : ""}{c.trend.pct}%</span>}
              </div>
              <div className="mt-3 text-sm font-medium text-slate-500">{c.label}</div>
              <div className="mt-1 text-[28px] font-bold text-slate-800">{c.value}</div>
            </div>
          );
          return c.href ? <Link key={c.label} href={c.href}>{body}</Link> : <div key={c.label}>{body}</div>;
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <CashflowChart rows={rows} money={money} />
          <div className="rounded-lg border border-slate-200 bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-slate-200 p-4 font-display text-lg font-bold text-slate-800">Recent activity <span className="flex items-center gap-3 text-sm font-normal">{advanced && canDownload && <button className="text-indigo-600" onClick={() => toExcel(rows.slice(0, more), { cat: catName, item: itemName, person: personName }, "recent.xlsx")}>Excel</button>}{advanced && canWrite && <button className="text-indigo-600" onClick={() => setForm({})}>Add</button>}<Link href="/app/ledger" className="text-indigo-600">Ledger</Link></span></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th>Category / Item</th><th>Member</th><th>Mode</th><th className="p-3 text-right">Amount</th></tr></thead>
                <tbody>
                  {rows.slice(0, more).map((r) => (
                    <tr key={r.id} className={rowClickable} {...rowActivate(() => setDetail(r), `Open ${dmy(r.entry_date)} ${catName(r.category_id) || r.type} ${money(r.amount)}`)}>
                      <td className="p-3 whitespace-nowrap text-slate-600">{dmy(r.entry_date)}</td>
                      <td><div className="font-medium text-slate-800">{catName(r.category_id) || r.type}{r.item_id && ` · ${itemName(r.item_id)}`}</div>{r.note && <div className="text-xs text-slate-500">{r.note}</div>}</td>
                      <td className="text-slate-600">{personName(r.person_id) || "—"}</td>
                      <td className="text-slate-600">{r.payment_mode}</td>
                      <td className={`p-3 text-right font-semibold whitespace-nowrap ${r.type === "income" ? "text-emerald-600" : "text-slate-800"}`}>{r.type === "income" ? "+" : ""}{money(r.amount)}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={5} className="p-6 text-center text-sm text-slate-400">No entries yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {rows.length > more && <button className="w-full border-t border-slate-200 p-3 text-sm text-indigo-600" onClick={() => setMore(more + 15)}>Show 15 more</button>}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-surface p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between font-display text-lg font-bold text-slate-800">Most spending <Link href="/app/analytics" className="text-sm font-normal text-indigo-600">Analytics</Link></div>
            <div className="space-y-3">
              {topSpending.map(({ c, amt, n }) => (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">{c.name[0]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{c.name}</div>
                    <div className="text-xs text-slate-500">{n} transaction{n === 1 ? "" : "s"}</div>
                  </div>
                  <div className="text-sm font-semibold text-slate-800">{money(amt)}</div>
                </div>
              ))}
              {!topSpending.length && <div className="text-sm text-slate-400">No expenses yet this month.</div>}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-surface p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between font-display text-lg font-bold text-slate-800">Budget &amp; limits {canManage && <Link href="/app/settings" className="text-sm font-normal text-indigo-600">Configure</Link>}</div>
            <div className="space-y-3">{gauges.map((g) => <Gauge key={g.label} {...g} money={money} />)}
              {!gauges.length && <div className="text-sm text-slate-400">No limits set. {canManage ? "Set a monthly budget or category limits in Settings." : ""}</div>}</div>
          </div>
        </div>
      </div>

      {form && <EntryForm entry={form.entry} onClose={() => setForm(null)} onSaved={() => { setForm(null); setDetail(null); load(); }} />}
      {detail && !form && <EntryDetail entry={detail} onClose={() => setDetail(null)} onEdit={() => setForm({ entry: detail })} onChanged={() => { setDetail(null); load(); }} />}
    </div>
  );
}
