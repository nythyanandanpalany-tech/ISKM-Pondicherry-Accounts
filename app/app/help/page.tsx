"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/db";
import { useWs } from "@/components/WorkspaceProvider";
import { input, btnPrimary } from "@/components/ui";
import { brand } from "@/lib/brand";

const FAQ: [string, [string, string][]][] = [
  ["Getting started", [["What is a workspace?", "One set of books — the temple’s main accounts, say, or a separate set kept for a festival. You can belong to several and switch between them from the sidebar."], ["How do I add an entry?", "Press + Add entry on the Dashboard or Ledger. Choose Expense or Income and fill the form."], ["Why is there a verse on the Dashboard?", "A verse from the Gītā, the Bhāgavatam or Śrī Īśopaniṣad appears each day, chosen for what it says about stewardship and seva. It changes at midnight and is the same for everyone in the temple."]]],
  ["Entries & budgets", [["Why does it ask for a bill photo?", "If you set “Receipt / bill available” to Yes, a photo of the bill is required, so that every rupee spent on the temple’s behalf has proof behind it."], ["What is the payment screenshot for?", "It is the UPI/bank app screenshot. Accountants use it with the bill to match the entry to the bank statement."], ["How do budgets work?", "Owners/admins set monthly limits per category or item in Settings. Gauges on the Dashboard turn amber at 80% and red when exceeded."]]],
  ["Members & roles", [["What can each role do?", "Owner/Admin: everything. Editor: add and edit own entries. Viewer: read only. Owners decide whether editors/viewers see the whole workspace and may download."]]],
  ["Claims & settlements", [["How do I claim a reimbursement?", "When you pay for something for the temple out of your own pocket, tick “Paid from own pocket” on the expense. It appears under Claims as submitted; an admin approves and settles it."]]],
  ["Bank reconciliation", [["How does matching work?", "Import your bank CSV, open Reconcile, pick a bank row and check the suggested entries with their bill and payment screenshot side by side. Auto-match links only unambiguous ones."]]],
  ["Reports & exports", [["What can I export?", "Ledger and Claims to Excel, any page to PDF via Print, the daily Report as PNG or shared text."]]],
  ["Account, data & privacy", [["Who can see my images?", "Only members of the workspace. The photo store is private, and each image is shown through a link that stops working after an hour. Nothing is public, and nothing is reachable without signing in."], ["Can we put our own temple name on reports?", "Yes — the name, address and crest on printed vouchers and the daily report all come from one file, lib/brand.ts. Ask whoever maintains the app to edit it."]]],
];

function Inner() {
  const [tab, setTab] = useState(useSearchParams().get("tab") === "privacy" ? "privacy" : "help");
  const [q, setQ] = useState("");
  const { ws } = useWs();
  const [kind, setKind] = useState("feature"); const [done, setDone] = useState(""); const [oops, setOops] = useState("");
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const d = new FormData(e.currentTarget);
    const { error } = await db.from("feedback").insert({ kind: tab === "support" ? "support" : kind, subject: String(d.get("s")), body: String(d.get("m")), workspace_id: ws.id });
    if (error) { setDone(""); return setOops(error.message); }
    (e.target as HTMLFormElement).reset(); setOops(""); setDone("Thank you — your message was sent.");
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-[26px] font-bold text-slate-800">Help &amp; support</h1>
      <p className="-mt-2 text-sm text-slate-500">{brand.greeting}. If something here does not answer your question, write to us from the Support tab.</p>
      <div className="flex gap-2 text-sm">{["help", "support", "suggestions", "privacy"].map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 capitalize ${tab === t ? "bg-indigo-600 text-white" : "border border-slate-300 bg-surface"}`}>{t}</button>)}</div>
      {tab === "help" && (<><input className={input} placeholder="Search help…" value={q} onChange={(e) => setQ(e.target.value)} />
        {FAQ.map(([sec, qs]) => { const f = qs.filter(([a, b]) => `${a} ${b}`.toLowerCase().includes(q.toLowerCase())); return f.length ? (
          <section key={sec} className="rounded-lg border border-slate-200 bg-surface shadow-card p-4"><h2 className="mb-2 font-semibold">{sec}</h2>{f.map(([a, b]) => <details key={a} className="border-t py-2 text-sm"><summary className="cursor-pointer font-medium">{a}</summary><p className="mt-1 text-slate-600">{b}</p></details>)}</section>) : null; })}</>)}
      {(tab === "support" || tab === "suggestions") && (
        <form className="space-y-3 rounded-lg border border-slate-200 bg-surface shadow-card p-4" onSubmit={send}>
          <h2 className="font-semibold">{tab === "support" ? "Customer support" : "Suggestions"}</h2>
          {tab === "suggestions" && <div className="flex gap-2 text-sm">{[["feature", "Feature request"], ["interface", "Interface improvement"], ["bug", "Bug report"]].map(([k, l]) => <button type="button" key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 ${kind === k ? "bg-indigo-600 text-white" : "border"}`}>{l}</button>)}</div>}
          <input name="s" className={input} placeholder={tab === "support" ? "Subject" : "One-line headline"} required maxLength={200} /><textarea name="m" className={input} rows={5} maxLength={4000} placeholder="Details (max 4000 characters)" required />
          <button className={btnPrimary}>{tab === "support" ? "Send message" : "Send suggestion"}</button>{done && <p role="status" className="text-sm text-emerald-700">{done}</p>}{oops && <p role="alert" className="text-sm text-red-700">{oops}</p>}</form>)}
      {tab === "privacy" && (<section className="space-y-2 rounded-lg border border-slate-200 bg-surface shadow-card p-4 text-sm text-slate-700"><h2 className="font-semibold">Privacy</h2>
        <p><b>Kept:</b> your entries, categories, people, uploaded bills and payment screenshots, and bank rows you import.</p>
        <p><b>Not kept:</b> bank passwords or card numbers — the app never asks for them.</p>
        <p><b>Access:</b> only members of a workspace see its data. Images live in a private store and are shown through links that expire after an hour.</p>
        <p><b>Your data:</b> export to Excel at any time. An owner can delete a workspace, which removes its entries, bank rows, store records, history and every photo in it.</p></section>)}
    </div>
  );
}
export default function Help() { return <Suspense><Inner /></Suspense>; }
