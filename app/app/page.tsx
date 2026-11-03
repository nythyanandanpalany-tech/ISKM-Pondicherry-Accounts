"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy, inr } from "@/lib/format";
import type { Expense } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { StatusBadge } from "@/components/ui";

export default function Dashboard() {
  const { profile, isStaff } = useAuth();
  const [rows, setRows] = useState<Expense[]>([]);
  const [unmatchedTxns, setUnmatchedTxns] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);

  useEffect(() => {
    supabase.from("expenses").select("*").order("expense_date", { ascending: false }).then(({ data }) => setRows((data as Expense[]) ?? []));
    if (isStaff) {
      supabase.from("bank_transactions").select("id", { count: "exact", head: true }).eq("direction", "debit").is("matched_expense_id", null).then(({ count }) => setUnmatchedTxns(count ?? 0));
      supabase.from("bank_transactions").select("id", { count: "exact", head: true }).not("matched_expense_id", "is", null).then(({ count }) => setMatchedCount(count ?? 0));
    }
  }, [isStaff]);

  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = rows.filter((r) => r.expense_date.startsWith(month) && r.status !== "rejected").reduce((s, r) => s + r.amount, 0);
  const cards: [string, string, string?][] = [
    ["This month", inr(thisMonth)],
    ["Pending approval", String(rows.filter((r) => r.status === "pending").length), "/app/expenses"],
    ["Missing bill", String(rows.filter((r) => !r.bill_path).length), "/app/expenses"],
    ["Missing payment screenshot", String(rows.filter((r) => !r.payment_proof_path).length), "/app/expenses"],
    ...(isStaff ? [["Bank debits to match", String(unmatchedTxns), "/app/reconcile"], ["Matched", String(matchedCount), "/app/reconcile"]] as [string, string, string][] : []),
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Hare Krishna, {profile.full_name} 🙏</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map(([t, v, href]) => {
          const c = <div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">{t}</div><div className="mt-1 text-2xl font-bold">{v}</div></div>;
          return href ? <Link key={t} href={href}>{c}</Link> : <div key={t}>{c}</div>;
        })}
      </div>
      <div className="rounded-xl border bg-white">
        <div className="border-b p-3 font-semibold">Recent expenses</div>
        {rows.slice(0, 8).map((r) => (
          <div key={r.id} className="flex items-center justify-between border-b p-3 text-sm last:border-0">
            <div><div className="font-medium">{r.title}</div><div className="text-xs text-slate-500">{dmy(r.expense_date)} · {r.vendor}</div></div>
            <div className="flex items-center gap-3"><StatusBadge status={r.status} /><b>{inr(r.amount)}</b></div>
          </div>
        ))}
        {!rows.length && <div className="p-6 text-center text-sm text-slate-400">No expenses yet. <Link href="/app/expenses" className="text-indigo-600">Add the first one</Link>.</div>}
      </div>
    </div>
  );
}
