"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { input } from "@/components/ui";

const FAQ: [string, [string, string][]][] = [
  ["Getting started", [["What is a workspace?", "One set of books, e.g. your temple’s accounts. You can belong to several and switch from the top bar."], ["How do I add an entry?", "Press + Add entry on the Dashboard or Ledger. Choose Expense or Income and fill the form."]]],
  ["Entries & budgets", [["Why does it ask for a bill photo?", "If you set “Receipt / bill available” to Yes, a photo of the bill is required so every rupee has proof."], ["What is the payment screenshot for?", "It is the UPI/bank app screenshot. Accountants use it with the bill to match the entry to the bank statement."], ["How do budgets work?", "Owners/admins set monthly limits per category or item in Settings. Gauges on the Dashboard turn amber at 80% and red when exceeded."]]],
  ["Members & roles", [["What can each role do?", "Owner/Admin: everything. Editor: add and edit own entries. Viewer: read only. Owners decide whether editors/viewers see the whole workspace and may download."]]],
  ["Claims & settlements", [["How do I claim a reimbursement?", "Tick “Paid from own pocket” when adding an expense. It appears under Claims as submitted; an admin approves and settles it."]]],
  ["Bank reconciliation", [["How does matching work?", "Import your bank CSV, open Reconcile, pick a bank row and check the suggested entries with their bill and payment screenshot side by side. Auto-match links only unambiguous ones."]]],
  ["Reports & exports", [["What can I export?", "Ledger and Claims to Excel, any page to PDF via Print, the daily Report as PNG or shared text."]]],
  ["Account, data & privacy", [["Who can see my images?", "Only members of the workspace, through short-lived private links. Nothing is public."]]],
];

function Inner() {
  const [tab, setTab] = useState(useSearchParams().get("tab") === "privacy" ? "privacy" : "help");
  const [q, setQ] = useState("");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex gap-2 text-sm">{["help", "support", "suggestions", "privacy"].map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 capitalize ${tab === t ? "bg-indigo-600 text-white" : "border bg-white"}`}>{t}</button>)}</div>
      {tab === "help" && (<><input className={input} placeholder="Search help…" value={q} onChange={(e) => setQ(e.target.value)} />
        {FAQ.map(([sec, qs]) => { const f = qs.filter(([a, b]) => `${a} ${b}`.toLowerCase().includes(q.toLowerCase())); return f.length ? (
          <section key={sec} className="rounded-xl border bg-white p-4"><h2 className="mb-2 font-semibold">{sec}</h2>{f.map(([a, b]) => <details key={a} className="border-t py-2 text-sm"><summary className="cursor-pointer font-medium">{a}</summary><p className="mt-1 text-slate-600">{b}</p></details>)}</section>) : null; })}</>)}
      {(tab === "support" || tab === "suggestions") && (
        <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); location.href = `mailto:?subject=${encodeURIComponent(`[${tab}] ${d.get("s")}`)}&body=${encodeURIComponent(String(d.get("m")))}`; }}>
          <h2 className="font-semibold capitalize">{tab === "support" ? "Customer support" : "Suggestions"}</h2>
          <p className="text-xs text-slate-500">Opens your email app. Set the support address in app/app/help/page.tsx before launch.</p>
          <input name="s" className={input} placeholder="Subject" required /><textarea name="m" className={input} rows={5} maxLength={4000} placeholder="Message" required />
          <button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">Send</button></form>)}
      {tab === "privacy" && (<section className="space-y-2 rounded-xl border bg-white p-4 text-sm text-slate-700"><h2 className="font-semibold">Privacy</h2>
        <p><b>Kept:</b> your entries, categories, people, uploaded bills and payment screenshots, and bank rows you import.</p>
        <p><b>Not kept:</b> bank passwords or card numbers — the app never asks for them.</p>
        <p><b>Access:</b> only members of a workspace see its data; images are private and served by short-lived links.</p>
        <p><b>Your data:</b> export to Excel anytime; owners can delete a workspace and everything in it.</p></section>)}
    </div>
  );
}
export default function Help() { return <Suspense><Inner /></Suspense>; }
