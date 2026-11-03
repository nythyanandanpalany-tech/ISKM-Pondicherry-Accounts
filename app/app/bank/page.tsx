"use client";
import { useCallback, useEffect, useState } from "react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { dmy, num, parseDate, today } from "@/lib/format";
import type { Txn } from "@/lib/types";
import { useWs } from "@/components/WorkspaceProvider";
import { btnDanger, btnGhost, btnPrimary, input } from "@/components/ui";

type Row = Record<string, string>;
const find = (cols: string[], ...keys: string[]) => cols.find((c) => keys.some((k) => c.toLowerCase().includes(k)));

export default function Bank() {
  const { ws, canManage, money } = useWs();
  const [txns, setTxns] = useState<Txn[]>([]); const [msg, setMsg] = useState("");
  const [manual, setManual] = useState({ txn_date: today(), description: "", reference: "", amount: "", direction: "debit" });
  const load = useCallback(async () => {
    const { data } = await supabase.from("bank_transactions").select("*").eq("workspace_id", ws.id).order("txn_date", { ascending: false }).limit(1000);
    setTxns((data as Txn[]) ?? []);
  }, [ws.id]);
  useEffect(() => { load(); }, [load]);
  if (!canManage) return <p className="text-sm text-slate-500">Only owners and admins can manage the bank statement.</p>;

  function importCsv(file: File) {
    Papa.parse<Row>(file, { header: true, skipEmptyLines: true, complete: async (res) => {
      const cols = res.meta.fields ?? [];
      const cDate = find(cols, "date"), cDesc = find(cols, "narration", "description", "particulars", "remarks"), cRef = find(cols, "ref", "chq", "utr");
      const cDr = find(cols, "withdraw", "debit"), cCr = find(cols, "deposit", "credit"), cAmt = find(cols, "amount");
      if (!cDate || !(cDr || cAmt)) return setMsg("Could not find Date and Debit/Amount columns in this CSV.");
      const out = res.data.flatMap((r) => {
        const d = parseDate(r[cDate]); if (!d) return [];
        let amount = 0, direction: "debit" | "credit" = "debit";
        if (cDr || cCr) { const dr = num(cDr && r[cDr]), cr = num(cCr && r[cCr]); if (dr > 0) amount = dr; else if (cr > 0) { amount = cr; direction = "credit"; } }
        else { const a = num(r[cAmt!]); amount = Math.abs(a); direction = a < 0 ? "debit" : "credit"; }
        return amount ? [{ workspace_id: ws.id, txn_date: d, description: cDesc ? r[cDesc] : null, reference: cRef ? r[cRef] : null, amount, direction }] : [];
      });
      if (!out.length) return setMsg("No valid rows found.");
      const { error } = await supabase.from("bank_transactions").insert(out);
      setMsg(error ? error.message : `Imported ${out.length} transactions.`); load();
    } });
  }
  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("bank_transactions").insert({ ...manual, workspace_id: ws.id, amount: parseFloat(manual.amount) });
    if (error) return setMsg(error.message);
    setManual({ ...manual, description: "", reference: "", amount: "" }); load();
  }
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Bank Statement</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-xl border bg-white p-4"><div className="font-semibold">Import statement (CSV)</div>
          <p className="text-xs text-slate-500">Download the CSV from net-banking. Date, Narration, Withdrawal/Debit, Deposit/Credit and Ref No columns are detected automatically.</p>
          <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} className="text-sm" />{msg && <p className="text-sm text-indigo-700">{msg}</p>}</div>
        <form onSubmit={addManual} className="space-y-2 rounded-xl border bg-white p-4"><div className="font-semibold">Add a transaction manually</div>
          <div className="grid grid-cols-3 gap-2">
            <input className={input} type="date" value={manual.txn_date} onChange={(e) => setManual({ ...manual, txn_date: e.target.value })} required />
            <input className={input} type="number" step="0.01" placeholder="Amount" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} required />
            <select className={input} value={manual.direction} onChange={(e) => setManual({ ...manual, direction: e.target.value })}><option value="debit">Debit</option><option value="credit">Credit</option></select></div>
          <input className={input} placeholder="Narration" value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} />
          <input className={input} placeholder="Reference / UTR" value={manual.reference} onChange={(e) => setManual({ ...manual, reference: e.target.value })} />
          <button className={btnPrimary}>Add</button></form>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th>Narration</th><th>Ref</th><th className="text-right">Amount</th><th className="px-3">Matched</th><th /></tr></thead>
        <tbody>{txns.map((t) => (<tr key={t.id} className="border-t"><td className="p-3 whitespace-nowrap">{dmy(t.txn_date)}</td><td className="max-w-xs truncate">{t.description}</td><td>{t.reference}</td>
          <td className={`text-right font-medium whitespace-nowrap ${t.direction === "credit" ? "text-emerald-600" : ""}`}>{t.direction === "credit" ? "+" : "−"}{money(t.amount)}</td>
          <td className="px-3 text-center">{t.matched_entry_id ? "🔗" : "—"}</td><td><button className={btnDanger} onClick={async () => { await supabase.from("bank_transactions").delete().eq("id", t.id); load(); }}>×</button></td></tr>))}
          {!txns.length && <tr><td colSpan={6} className="p-6 text-center text-slate-400">No transactions yet.</td></tr>}</tbody></table></div>
      <button className={btnGhost} onClick={async () => { if (confirm("Delete ALL unmatched transactions?")) { await supabase.from("bank_transactions").delete().eq("workspace_id", ws.id).is("matched_entry_id", null); load(); } }}>Clear unmatched</button>
    </div>
  );
}
