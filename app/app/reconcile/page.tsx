"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy, inr } from "@/lib/format";
import { suggest } from "@/lib/match";
import type { Expense, Txn } from "@/lib/types";
import { Receipt, btnGhost, btnPrimary, input } from "@/components/ui";

export default function Reconcile() {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [all, setAll] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, e] = await Promise.all([
      supabase.from("bank_transactions").select("*").eq("direction", "debit").order("txn_date", { ascending: false }),
      supabase.from("expenses").select("*").neq("status", "rejected").order("expense_date", { ascending: false }),
    ]);
    setTxns((t.data as Txn[]) ?? []); setExpenses((e.data as Expense[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const usedIds = useMemo(() => new Set(txns.map((t) => t.matched_expense_id).filter(Boolean) as string[]), [txns]);
  const free = useMemo(() => expenses.filter((e) => !usedIds.has(e.id)), [expenses, usedIds]);
  const open = txns.filter((t) => !t.matched_expense_id);
  const done = txns.filter((t) => t.matched_expense_id);
  const list = tab === "open" ? open : done;
  const current = txns.find((t) => t.id === sel) ?? null;
  const expById = (id: string | null) => expenses.find((e) => e.id === id);

  const cands = useMemo(() => {
    if (!current || current.matched_expense_id) return [];
    const ranked = suggest(current, free);
    if (all) {
      const ids = new Set(ranked.map((c) => c.expense.id));
      const rest = free.filter((e) => !ids.has(e.id) && `${e.title} ${e.vendor ?? ""}`.toLowerCase().includes(search.toLowerCase()))
        .map((expense) => ({ expense, score: 0, reasons: [] as string[] }));
      return [...ranked, ...rest].slice(0, 30);
    }
    return ranked.slice(0, 6);
  }, [current, free, all, search]);

  async function match(t: Txn, e: Expense) {
    const { error } = await supabase.from("bank_transactions").update({ matched_expense_id: e.id }).eq("id", t.id);
    if (error) return alert(error.message);
    if (e.status === "pending") await supabase.from("expenses").update({ status: "approved" }).eq("id", e.id);
    setSel(null); load();
  }
  async function unmatch(t: Txn) { await supabase.from("bank_transactions").update({ matched_expense_id: null }).eq("id", t.id); setSel(null); load(); }

  async function autoMatch() {
    setBusy(true);
    const taken = new Set<string>(); let n = 0;
    for (const t of open) {
      const c = suggest(t, free.filter((e) => !taken.has(e.id)));
      const exact = c.filter((x) => x.score >= 70);
      if (exact.length === 1 && (!c[1] || c[1].score < exact[0].score)) {
        const { error } = await supabase.from("bank_transactions").update({ matched_expense_id: exact[0].expense.id }).eq("id", t.id);
        if (!error) { taken.add(exact[0].expense.id); n++; }
      }
    }
    setBusy(false); alert(`Auto-matched ${n} transaction(s). Review the rest manually.`); load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Reconcile</h1>
        <button className={btnPrimary} disabled={busy || !open.length} onClick={autoMatch}>⚡ Auto-match confident ones</button>
      </div>
      <p className="text-sm text-slate-500">Pick a bank debit on the left. Suggested expenses appear on the right with the payment screenshot and bill side by side, so you can verify before matching.</p>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="mb-2 flex gap-2">
            <button className={tab === "open" ? btnPrimary : btnGhost} onClick={() => { setTab("open"); setSel(null); }}>To match ({open.length})</button>
            <button className={tab === "done" ? btnPrimary : btnGhost} onClick={() => { setTab("done"); setSel(null); }}>Matched ({done.length})</button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto rounded-xl border bg-white">
            {list.map((t) => (
              <button key={t.id} onClick={() => setSel(t.id)} className={`block w-full border-b p-3 text-left text-sm last:border-0 hover:bg-slate-50 ${sel === t.id ? "bg-indigo-50" : ""}`}>
                <div className="flex justify-between"><span className="text-slate-500">{dmy(t.txn_date)}</span><b>{inr(t.amount)}</b></div>
                <div className="truncate">{t.description}</div><div className="text-xs text-slate-400">{t.reference}</div>
                {t.matched_expense_id && <div className="mt-1 text-xs text-emerald-700">🔗 {expById(t.matched_expense_id)?.title}</div>}
              </button>
            ))}
            {!list.length && <div className="p-6 text-center text-sm text-slate-400">{tab === "open" ? "Nothing left to match 🎉" : "No matches yet."}</div>}
          </div>
        </div>

        <div className="space-y-3 lg:col-span-3">
          {!current && <div className="rounded-xl border border-dashed p-10 text-center text-sm text-slate-400">Select a bank transaction</div>}
          {current && current.matched_expense_id && (() => { const e = expById(current.matched_expense_id); return e && (
            <div className="rounded-xl border bg-white p-4">
              <div className="font-semibold">{e.title} · {inr(e.amount)}</div>
              <div className="mb-3 text-xs text-slate-500">{dmy(e.expense_date)} · {e.vendor}</div>
              <div className="grid grid-cols-2 gap-3"><Receipt path={e.payment_proof_path} label="Payment screenshot" size="lg" /><Receipt path={e.bill_path} label="Bill" size="lg" /></div>
              <button className={`${btnGhost} mt-3`} onClick={() => unmatch(current)}>Unmatch</button>
            </div>); })()}
          {current && !current.matched_expense_id && (<>
            <div className="rounded-xl bg-slate-800 p-3 text-sm text-white">Bank: <b>{inr(current.amount)}</b> on {dmy(current.txn_date)} — {current.description} {current.reference}</div>
            {all && <input className={input} placeholder="Search expenses by title / vendor" value={search} onChange={(e) => setSearch(e.target.value)} />}
            {cands.map(({ expense: e, score, reasons }) => (
              <div key={e.id} className="rounded-xl border bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><div className="font-semibold">{e.title} · {inr(e.amount)}</div>
                    <div className="text-xs text-slate-500">{dmy(e.expense_date)} · {e.vendor} {e.utr && `· UTR ${e.utr}`}</div>
                    <div className="mt-1 flex flex-wrap gap-1">{reasons.map((r) => <span key={r} className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">{r}</span>)}
                      {score > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">score {score}</span>}</div></div>
                  <button className={btnPrimary} onClick={() => match(current, e)}>Match</button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3"><Receipt path={e.payment_proof_path} label="Payment screenshot" /><Receipt path={e.bill_path} label="Bill" /></div>
              </div>
            ))}
            {!cands.length && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">No likely expense found. Try “search all expenses”.</div>}
            <button className="text-sm text-indigo-600" onClick={() => setAll(!all)}>{all ? "Show only suggestions" : "Search all unmatched expenses"}</button>
          </>)}
        </div>
      </div>
    </div>
  );
}
