"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy } from "@/lib/format";
import { suggest } from "@/lib/match";
import type { Entry, Txn } from "@/lib/types";
import { useWs } from "@/components/WorkspaceProvider";
import { Receipt, btnGhost, btnPrimary, input } from "@/components/ui";

export default function Reconcile() {
  const { ws, canManage, catName, itemName, personName, money } = useWs();
  const [txns, setTxns] = useState<Txn[]>([]); const [entries, setEntries] = useState<Entry[]>([]);
  const [sel, setSel] = useState<string | null>(null); const [tab, setTab] = useState<"open" | "done">("open");
  const [all, setAll] = useState(false); const [search, setSearch] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [t, e] = await Promise.all([
      supabase.from("bank_transactions").select("*").eq("workspace_id", ws.id).order("txn_date", { ascending: false }),
      supabase.from("entries").select("*").eq("workspace_id", ws.id).order("entry_date", { ascending: false }).limit(5000),
    ]);
    setTxns((t.data as Txn[]) ?? []); setEntries((e.data as Entry[]) ?? []);
  }, [ws.id]);
  useEffect(() => { load(); }, [load]);

  const used = useMemo(() => new Set(txns.map((t) => t.matched_entry_id).filter(Boolean) as string[]), [txns]);
  const free = useMemo(() => entries.filter((e) => !used.has(e.id)), [entries, used]);
  const open = txns.filter((t) => !t.matched_entry_id), done = txns.filter((t) => t.matched_entry_id);
  const list = tab === "open" ? open : done;
  const current = txns.find((t) => t.id === sel) ?? null;
  const entryById = (id: string | null) => entries.find((e) => e.id === id);
  const title = (e: Entry) => `${catName(e.category_id) || e.type}${e.item_id ? " · " + itemName(e.item_id) : ""}`;

  const cands = useMemo(() => {
    if (!current || current.matched_entry_id) return [];
    const ranked = suggest(current, free, personName);
    if (!all) return ranked.slice(0, 6);
    const ids = new Set(ranked.map((c) => c.entry.id));
    const rest = free.filter((e) => !ids.has(e.id) && `${title(e)} ${personName(e.person_id)} ${e.note ?? ""}`.toLowerCase().includes(search.toLowerCase())).map((entry) => ({ entry, score: 0, reasons: [] as string[] }));
    return [...ranked, ...rest].slice(0, 30);
  }, [current, free, all, search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canManage) return <p className="text-sm text-slate-500">Only owners and admins can reconcile.</p>;
  async function match(t: Txn, e: Entry) { const { error } = await supabase.from("bank_transactions").update({ matched_entry_id: e.id }).eq("id", t.id); if (error) return alert(error.message); setSel(null); load(); }
  async function unmatch(t: Txn) { await supabase.from("bank_transactions").update({ matched_entry_id: null }).eq("id", t.id); setSel(null); load(); }
  async function autoMatch() {
    setBusy(true); const taken = new Set<string>(); let n = 0;
    for (const t of open) {
      const c = suggest(t, free.filter((e) => !taken.has(e.id)), personName); const strong = c.filter((x) => x.score >= 70);
      if (strong.length === 1) { const { error } = await supabase.from("bank_transactions").update({ matched_entry_id: strong[0].entry.id }).eq("id", t.id); if (!error) { taken.add(strong[0].entry.id); n++; } }
    }
    setBusy(false); alert(`Auto-matched ${n} transaction(s). Review the rest manually.`); load();
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-bold">Reconcile</h1>
        <button className={btnPrimary} disabled={busy || !open.length} onClick={autoMatch}>⚡ Auto-match confident ones</button></div>
      <p className="text-sm text-slate-500">Pick a bank row on the left. Likely entries appear on the right with the bill and payment screenshot side by side so you can verify before matching.</p>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="mb-2 flex gap-2"><button className={tab === "open" ? btnPrimary : btnGhost} onClick={() => { setTab("open"); setSel(null); }}>To match ({open.length})</button>
            <button className={tab === "done" ? btnPrimary : btnGhost} onClick={() => { setTab("done"); setSel(null); }}>Matched ({done.length})</button></div>
          <div className="max-h-[70vh] overflow-y-auto rounded-xl border bg-white">
            {list.map((t) => (<button key={t.id} onClick={() => setSel(t.id)} className={`block w-full border-b p-3 text-left text-sm hover:bg-slate-50 ${sel === t.id ? "bg-indigo-50" : ""}`}>
              <div className="flex justify-between"><span className="text-slate-500">{dmy(t.txn_date)} · {t.direction}</span><b>{money(t.amount)}</b></div>
              <div className="truncate">{t.description}</div><div className="text-xs text-slate-400">{t.reference}</div>
              {t.matched_entry_id && entryById(t.matched_entry_id) && <div className="mt-1 text-xs text-emerald-700">🔗 {title(entryById(t.matched_entry_id)!)}</div>}</button>))}
            {!list.length && <div className="p-6 text-center text-sm text-slate-400">{tab === "open" ? "Nothing left to match 🎉" : "No matches yet."}</div>}
          </div>
        </div>
        <div className="space-y-3 lg:col-span-3">
          {!current && <div className="rounded-xl border border-dashed p-10 text-center text-sm text-slate-400">Select a bank transaction</div>}
          {current?.matched_entry_id && (() => { const e = entryById(current.matched_entry_id); return e && (<div className="rounded-xl border bg-white p-4">
            <div className="font-semibold">{title(e)} · {money(e.amount)}</div><div className="mb-3 text-xs text-slate-500">{dmy(e.entry_date)} · {personName(e.person_id)}</div>
            <div className="grid grid-cols-2 gap-3"><Receipt path={e.bill_path} label="Bill" size="lg" /><Receipt path={e.payment_proof_path} label="Payment screenshot" size="lg" /></div>
            <button className={`${btnGhost} mt-3`} onClick={() => unmatch(current)}>Unmatch</button></div>); })()}
          {current && !current.matched_entry_id && (<>
            <div className="rounded-xl bg-slate-800 p-3 text-sm text-white">Bank: <b>{money(current.amount)}</b> {current.direction} on {dmy(current.txn_date)} — {current.description} {current.reference}</div>
            {all && <input className={input} placeholder="Search entries" value={search} onChange={(e) => setSearch(e.target.value)} />}
            {cands.map(({ entry: e, score, reasons }) => (<div key={e.id} className="rounded-xl border bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-semibold">{title(e)} · {money(e.amount)}</div>
                <div className="text-xs text-slate-500">{dmy(e.entry_date)} · {personName(e.person_id)} {e.reference_no && `· UTR ${e.reference_no}`}</div>
                <div className="mt-1 flex flex-wrap gap-1">{reasons.map((r) => <span key={r} className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">{r}</span>)}{score > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">score {score}</span>}</div></div>
                <button className={btnPrimary} onClick={() => match(current, e)}>Match</button></div>
              <div className="mt-2 grid grid-cols-2 gap-3"><Receipt path={e.bill_path} label="Bill" /><Receipt path={e.payment_proof_path} label="Payment screenshot" /></div></div>))}
            {!cands.length && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">No likely entry found. Try “search all”.</div>}
            <button className="text-sm text-indigo-600" onClick={() => setAll(!all)}>{all ? "Show only suggestions" : "Search all unmatched entries"}</button></>)}
        </div>
      </div>
    </div>
  );
}
