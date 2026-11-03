"use client";
import { useCallback, useEffect, useState } from "react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { dmy, inr, num, parseDate, today } from "@/lib/format";
import type { Txn } from "@/lib/types";
import { useLookups } from "@/lib/useLookups";
import { btnDanger, btnGhost, btnPrimary, input } from "@/components/ui";

type Row = Record<string, string>;
const find = (cols: string[], ...keys: string[]) => cols.find((c) => keys.some((k) => c.toLowerCase().includes(k)));

export default function Transactions() {
  const { accounts } = useLookups();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [accountId, setAccountId] = useState("");
  const [msg, setMsg] = useState("");
  const [manual, setManual] = useState({ txn_date: today(), description: "", reference: "", amount: "" });

  const load = useCallback(async () => {
    const { data } = await supabase.from("bank_transactions").select("*").order("txn_date", { ascending: false }).limit(500);
    setTxns((data as Txn[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  function importCsv(file: File) {
    Papa.parse<Row>(file, {
      header: true, skipEmptyLines: true,
      complete: async (res) => {
        const cols = res.meta.fields ?? [];
        const cDate = find(cols, "date"), cDesc = find(cols, "narration", "description", "particulars", "remarks");
        const cRef = find(cols, "ref", "chq", "utr"), cDr = find(cols, "withdraw", "debit"), cCr = find(cols, "deposit", "credit"), cAmt = find(cols, "amount");
        if (!cDate || !(cDr || cAmt)) return setMsg("Could not find Date and Debit/Amount columns in this CSV.");
        const out = res.data.flatMap((r) => {
          const d = parseDate(r[cDate]); if (!d) return [];
          let amount = 0, direction: "debit" | "credit" = "debit";
          if (cDr || cCr) {
            const dr = num(cDr && r[cDr]), cr = num(cCr && r[cCr]);
            if (dr > 0) amount = dr; else if (cr > 0) { amount = cr; direction = "credit"; }
          } else { const a = num(r[cAmt!]); amount = Math.abs(a); direction = a < 0 ? "debit" : "credit"; }
          if (!amount) return [];
          return [{ txn_date: d, description: cDesc ? r[cDesc] : null, reference: cRef ? r[cRef] : null, amount, direction, account_id: accountId || null }];
        });
        if (!out.length) return setMsg("No valid rows found.");
        const { error } = await supabase.from("bank_transactions").insert(out);
        setMsg(error ? error.message : `Imported ${out.length} transactions.`);
        load();
      },
    });
  }
  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("bank_transactions").insert({ ...manual, amount: parseFloat(manual.amount), direction: "debit", account_id: accountId || null });
    if (error) return setMsg(error.message);
    setManual({ txn_date: today(), description: "", reference: "", amount: "" }); load();
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Bank Statement</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-xl border bg-white p-4">
          <div className="font-semibold">Import statement (CSV)</div>
          <p className="text-xs text-slate-500">Download the CSV from your net-banking. Columns like Date, Narration, Withdrawal/Debit, Deposit/Credit, Ref No are detected automatically.</p>
          <select className={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Account (optional)</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} className="text-sm" />
          {msg && <p className="text-sm text-indigo-700">{msg}</p>}
        </div>
        <form onSubmit={addManual} className="space-y-2 rounded-xl border bg-white p-4">
          <div className="font-semibold">Add a debit manually</div>
          <div className="grid grid-cols-2 gap-2">
            <input className={input} type="date" value={manual.txn_date} onChange={(e) => setManual({ ...manual, txn_date: e.target.value })} required />
            <input className={input} type="number" step="0.01" placeholder="Amount" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} required />
          </div>
          <input className={input} placeholder="Description / narration" value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} />
          <input className={input} placeholder="Reference / UTR" value={manual.reference} onChange={(e) => setManual({ ...manual, reference: e.target.value })} />
          <button className={btnPrimary}>Add</button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th>Description</th><th>Ref</th><th className="text-right">Amount</th><th className="px-3">Matched</th><th /></tr></thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-3 whitespace-nowrap">{dmy(t.txn_date)}</td><td className="max-w-xs truncate">{t.description}</td><td>{t.reference}</td>
                <td className={`text-right font-medium whitespace-nowrap ${t.direction === "credit" ? "text-emerald-600" : ""}`}>{t.direction === "credit" ? "+" : "−"}{inr(t.amount)}</td>
                <td className="px-3 text-center">{t.matched_expense_id ? "🔗" : "—"}</td>
                <td><button className={btnDanger} onClick={async () => { await supabase.from("bank_transactions").delete().eq("id", t.id); load(); }}>×</button></td>
              </tr>
            ))}
            {!txns.length && <tr><td colSpan={6} className="p-6 text-center text-slate-400">No transactions yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <button className={btnGhost} onClick={async () => { if (confirm("Delete ALL unmatched transactions?")) { await supabase.from("bank_transactions").delete().is("matched_expense_id", null); load(); } }}>Clear unmatched</button>
    </div>
  );
}
