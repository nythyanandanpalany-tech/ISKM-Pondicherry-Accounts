"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy } from "@/lib/format";
import type { Entry } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { useWs } from "@/components/WorkspaceProvider";
import { Receipt, input } from "@/components/ui";

export default function Bills() {
  const { advanced } = useAuth();
  const { ws, catName, itemName, personName, money } = useWs();
  const [rows, setRows] = useState<Entry[]>([]); const [q, setQ] = useState(""); const [only, setOnly] = useState("");
  useEffect(() => { supabase.from("entries").select("*").eq("workspace_id", ws.id).or("bill_path.not.is.null,payment_proof_path.not.is.null").order("entry_date", { ascending: false }).limit(300).then(({ data }) => setRows((data as Entry[]) ?? [])); }, [ws.id]);
  if (!advanced) return <p className="text-sm text-slate-500">“All Bills” is part of the Advanced view. Turn it on in Settings → My account.</p>;
  const shown = rows.filter((r) => (!only || (only === "both" ? r.bill_path && r.payment_proof_path : only === "bill" ? r.bill_path && !r.payment_proof_path : r.payment_proof_path && !r.bill_path)) && (!q || `${catName(r.category_id)} ${itemName(r.item_id)} ${personName(r.person_id)} ${r.note ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">All Bills</h1>
      <div className="flex flex-wrap gap-2"><input className={`${input} !w-64`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${input} !w-auto`} value={only} onChange={(e) => setOnly(e.target.value)}><option value="">All</option><option value="both">Bill + screenshot</option><option value="bill">Bill only</option><option value="proof">Screenshot only</option></select></div>
      <div className="grid gap-4 md:grid-cols-2">{shown.map((r) => (
        <div key={r.id} className="rounded-xl border bg-white p-3"><div className="mb-2 flex justify-between text-sm"><div><b>{catName(r.category_id) || r.type}</b> {itemName(r.item_id) && `· ${itemName(r.item_id)}`}<div className="text-xs text-slate-500">{dmy(r.entry_date)} · {personName(r.person_id)}</div></div><b>{money(r.amount)}</b></div>
          <div className="grid grid-cols-2 gap-3"><Receipt path={r.bill_path} label="Bill" /><Receipt path={r.payment_proof_path} label="Payment screenshot" /></div></div>))}
        {!shown.length && <div className="text-sm text-slate-400">Nothing found.</div>}</div>
    </div>
  );
}
