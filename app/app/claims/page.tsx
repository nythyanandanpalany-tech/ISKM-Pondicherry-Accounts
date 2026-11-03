"use client";
import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/db";
import { dmy } from "@/lib/format";
import { toExcel, toCsv } from "@/lib/export";
import { useAuth } from "@/components/AuthProvider";
import type { Entry } from "@/lib/types";
import { useWs } from "@/components/WorkspaceProvider";
import { btnGhost, btnPrimary } from "@/components/ui";

export default function Claims() {
  const { advanced } = useAuth();
  const { ws, canManage, canDownload, catName, itemName, personName, money } = useWs();
  const [rows, setRows] = useState<Entry[]>([]); const [who, setWho] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await db.from("entries").select("*").eq("workspace_id", ws.id).not("claim_status", "is", null).order("entry_date", { ascending: false });
    setRows((data as Entry[]) ?? []);
  }, [ws.id]);
  useEffect(() => { load(); }, [load]);

  const by = (s: string) => rows.filter((r) => r.claim_status === s).reduce((a, r) => a + r.amount, 0);
  const pending = rows.filter((r) => r.claim_status !== "settled");
  const balances = new Map<string, number>();
  pending.forEach((r) => balances.set(r.person_id ?? "", (balances.get(r.person_id ?? "") ?? 0) + r.amount));
  const list = who === null ? rows : rows.filter((r) => (r.person_id ?? "") === who);
  async function setStatus(r: Entry, s: "submitted" | "approved" | "settled") {
    const { error } = await db.from("entries").update({ claim_status: s, claim_settled_at: s === "settled" ? new Date().toISOString() : null }).eq("id", r.id);
    if (error) alert(error.message); load();
  }
  async function settleAll(person: string) {
    if (!confirm("Mark all pending claims of this member as settled?")) return;
    await db.from("entries").update({ claim_status: "settled", claim_settled_at: new Date().toISOString() }).eq("workspace_id", ws.id).neq("claim_status", "settled").not("claim_status", "is", null).eq("person_id", person);
    load();
  }
  const badge = (s: string) => <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${s === "settled" ? "bg-emerald-100 text-emerald-700" : s === "approved" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>{s}</span>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">Claims</h1>
        <div className="flex gap-2">{canDownload && <button className={btnGhost} onClick={() => toExcel(rows, { cat: catName, item: itemName, person: personName }, "claims.xlsx")}>Excel</button>}
          {canDownload && advanced && <button className={btnGhost} onClick={() => toCsv(rows, { cat: catName, item: itemName, person: personName }, "claims.csv")}>CSV</button>}</div></div>
      <p className="text-sm text-slate-500">Expenses paid from someone’s own pocket. Flow: submitted → approved → settled (reimbursed).</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Pending payout", money(by("submitted") + by("approved"))], ["Submitted", money(by("submitted"))], ["Approved", money(by("approved"))], ["Settled", money(by("settled"))]].map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-bold">{v}</div></div>))}
      </div>
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-2 font-semibold">Member balances</div>
        {[...balances.entries()].map(([p, amt]) => (
          <div key={p} className="flex items-center justify-between border-t py-2 text-sm">
            <button className="text-left text-indigo-700" onClick={() => setWho(who === p ? null : p)}>{personName(p || null) || "Unassigned"}</button>
            <span className="flex items-center gap-3"><b>{money(amt)}</b>{canManage && <button className={btnGhost} onClick={() => settleAll(p)}>Settle all</button>}</span>
          </div>))}
        {!balances.size && <div className="text-sm text-slate-400">Nothing owed. 🎉 Tick “Paid from own pocket” when adding an expense to start a claim.</div>}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <div className="border-b p-3 font-semibold">{who === null ? "All claims" : `Claims · ${personName(who || null) || "Unassigned"}`} {who !== null && <button className="ml-2 text-sm font-normal text-indigo-600" onClick={() => setWho(null)}>show all</button>}</div>
        <table className="w-full text-sm"><tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-3 whitespace-nowrap">{dmy(r.entry_date)}</td><td>{personName(r.person_id)}</td><td>{catName(r.category_id)} {r.note}</td>
              <td>{badge(r.claim_status!)}</td><td className="text-right font-medium">{money(r.amount)}</td>
              <td className="space-x-1 px-3 text-right whitespace-nowrap">{canManage && r.claim_status === "submitted" && <button className={btnPrimary} onClick={() => setStatus(r, "approved")}>Approve</button>}
                {canManage && r.claim_status !== "settled" && <button className={btnGhost} onClick={() => setStatus(r, "settled")}>Settle</button>}
                {canManage && r.claim_status === "settled" && <button className={btnGhost} onClick={() => setStatus(r, "approved")}>Undo</button>}</td>
            </tr>))}
          {!list.length && <tr><td className="p-6 text-center text-slate-400">No claims.</td></tr>}
        </tbody></table>
      </div>
    </div>
  );
}
