"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { parseDate, num } from "@/lib/format";
import { readExcel } from "@/lib/export";
import type { Role } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { setThemePref, useThemePref, type ThemePref } from "@/components/Theme";
import { startTour } from "@/components/Tour";
import StorageMeter, { useStorageUsage } from "@/components/StorageMeter";
import PhotoArchive from "@/components/PhotoArchive";
import { useWs } from "@/components/WorkspaceProvider";
import { btnDanger, btnGhost, btnPrimary, input } from "@/components/ui";

const card = "rounded-xl border bg-white p-4 space-y-3";
const lim = (v: string) => (v.trim() === "" ? null : parseFloat(v));

export default function Settings() {
  const router = useRouter();
  const { profile, advanced, reloadProfile, signOut } = useAuth();
  const theme = useThemePref();
  const [alerts, setAlerts] = useState(false);
  useEffect(() => { try { setAlerts(localStorage.getItem("ef_alerts") === "1"); } catch { /* ignore */ } }, []);
  const { ws, role, canManage, categories, items, people, members, reload, reloadWorkspaces, switchTo, workspaces, catName } = useWs();
  const storageUsed = useStorageUsage(canManage);
  const [acct, setAcct] = useState({ full_name: profile.full_name ?? "", username: profile.username ?? "" });
  const [pw, setPw] = useState(""); const [msg, setMsg] = useState("");
  const [w, setW] = useState({ name: ws.name, currency: ws.currency, date_format: ws.date_format, org_type: ws.org_type, monthly_budget: ws.monthly_budget?.toString() ?? ""  , primary_purchaser: ws.primary_purchaser ?? "" });
  useEffect(() => setW({ name: ws.name, currency: ws.currency, date_format: ws.date_format, org_type: ws.org_type, monthly_budget: ws.monthly_budget?.toString() ?? "", primary_purchaser: ws.primary_purchaser ?? "" }), [ws]);
  const [pName, setPName] = useState(""); const [mEmail, setMEmail] = useState(""); const [mRole, setMRole] = useState<Role>("editor");
  const [cName, setCName] = useState(""); const [cKind, setCKind] = useState<"expense" | "income">("expense"); const [iName, setIName] = useState(""); const [iCat, setICat] = useState("");
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };
  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok = "Saved.") => { const { error } = await p; if (error) return alert(error.message); note(ok); await reload(); };

  async function saveAccount() {
    const { error } = await supabase.from("profiles").update({ full_name: acct.full_name, username: acct.username.trim().toLowerCase() || null }).eq("id", profile.id);
    note(error ? error.message : "Account saved. Reload to see the new name.");
  }
  async function changePw() { if (pw.length < 6) return alert("Min 6 characters"); const { error } = await supabase.auth.updateUser({ password: pw }); note(error ? error.message : "Password changed."); setPw(""); }
  async function saveWs() {
    await run(supabase.from("workspaces").update({ name: w.name, currency: w.currency, date_format: w.date_format, org_type: w.org_type, monthly_budget: lim(w.monthly_budget), primary_purchaser: w.primary_purchaser || null }).eq("id", ws.id));
    await reloadWorkspaces();
  }
  async function importXlsx(file: File) {
    const rows = await readExcel(file); let ok = 0, skipped = 0;
    const cat = new Map(categories.map((c) => [`${c.kind}:${c.name.toLowerCase()}`, c.id])); const item = new Map(items.map((i) => [`${i.category_id}:${i.name.toLowerCase()}`, i.id]));
    const ppl = new Map(people.map((p) => [p.name.toLowerCase(), p.id]));
    for (const r of rows) {
      const date = parseDate(r["Bill Date"] || r["Date"]); const amount = num(r["Amount"]); if (!date || !amount) { skipped++; continue; }
      const type = (r["Type"] || "expense").toLowerCase().startsWith("inc") ? "income" : "expense";
      const cn = (r["Category"] || "").trim(); let cid = cn ? cat.get(`${type}:${cn.toLowerCase()}`) : undefined;
      if (cn && !cid) { const { data } = await supabase.from("categories").insert({ workspace_id: ws.id, name: cn, kind: type }).select().single(); if (data) { cid = data.id; cat.set(`${type}:${cn.toLowerCase()}`, cid!); } }
      const inn = (r["Item"] || "").trim(); let iid = cid && inn ? item.get(`${cid}:${inn.toLowerCase()}`) : undefined;
      if (cid && inn && !iid) { const { data } = await supabase.from("items").insert({ workspace_id: ws.id, category_id: cid, name: inn }).select().single(); if (data) { iid = data.id; item.set(`${cid}:${inn.toLowerCase()}`, iid!); } }
      const pn = (r["Member"] || "").trim(); let pid = pn ? ppl.get(pn.toLowerCase()) : undefined;
      if (pn && !pid) { const { data } = await supabase.from("people").insert({ workspace_id: ws.id, name: pn }).select().single(); if (data) { pid = data.id; ppl.set(pn.toLowerCase(), pid!); } }
      const st = (r["Status"] || "").toLowerCase();
      const { error } = await supabase.from("entries").insert({ workspace_id: ws.id, created_by: profile.id, type, entry_date: date, amount, category_id: cid ?? null, item_id: iid ?? null, person_id: pid ?? null,
        payment_mode: r["Mode"] || "Cash", note: r["Note"] || null, receipt_available: false, claim_status: ["submitted", "approved", "settled"].includes(st) ? st : null });
      if (error) skipped++; else ok++;
    }
    await reload(); note(`Imported ${ok} entries, skipped ${skipped}.`);
  }
  async function delWs() {
    if (prompt(`Type the workspace name (“${ws.name}”) to delete it and ALL its entries:`) !== ws.name) return;
    const { error } = await supabase.from("workspaces").delete().eq("id", ws.id); if (error) return alert(error.message);
    await reloadWorkspaces(); const other = workspaces.find((x) => x.id !== ws.id); if (other) switchTo(other.id); router.replace("/app");
  }
  async function leave() { if (!confirm("Leave this workspace?")) return; const { error } = await supabase.from("members").delete().eq("workspace_id", ws.id).eq("user_id", profile.id); if (error) return alert(error.message); await reloadWorkspaces(); router.replace("/app"); }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">Settings</h1>{msg && <span className="rounded bg-emerald-50 px-2 py-1 text-sm text-emerald-700">{msg}</span>}</div>
      <section className={card}><h2 className="font-semibold">My account</h2>
        <div className="grid gap-2 sm:grid-cols-3"><input className={input} placeholder="Full name" value={acct.full_name} onChange={(e) => setAcct({ ...acct, full_name: e.target.value })} />
          <input className={input} placeholder="@username" value={acct.username} onChange={(e) => setAcct({ ...acct, username: e.target.value })} /><button className={btnPrimary} onClick={saveAccount}>Save</button></div>
        <div className="flex gap-2"><input className={input} type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} /><button className={btnGhost} onClick={changePw}>Change password</button></div>
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
          <label className="text-xs">Appearance<select className={input} value={theme} onChange={(e) => setThemePref(e.target.value as ThemePref)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label className="text-xs">Option view<select className={input} value={advanced ? "adv" : "std"} onChange={async (e) => { const { error } = await supabase.from("profiles").update({ advanced: e.target.value === "adv" }).eq("id", profile.id); if (error) return alert(error.message); await reloadProfile(); }}><option value="std">Standard</option><option value="adv">Advanced (fund source, beneficiary, CSV, All Bills, modules…)</option></select></label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={alerts} onChange={async (e) => {
            if (e.target.checked) { if (!("Notification" in window)) return alert("This browser does not support notifications."); const p = await Notification.requestPermission(); if (p !== "granted") return alert("Notifications are blocked in this browser."); }
            try { localStorage.setItem("ef_alerts", e.target.checked ? "1" : "0"); } catch { /* ignore */ } setAlerts(e.target.checked); }} />Message alerts on this device</label>
          <button className={btnGhost} onClick={startTour}>Show guidelines</button>
          <button className={btnGhost} onClick={async () => { const { data, error } = await supabase.rpc("create_sample_workspace"); if (error) return alert(error.message); await reloadWorkspaces(); switchTo(data as string); note("Sample workspace added."); }}>Add sample workspace</button>
          <button className={btnGhost} onClick={async () => { if (!confirm("Remove the sample workspace(s) you own?")) return; const { error } = await supabase.rpc("remove_sample_data"); if (error) return alert(error.message); await reloadWorkspaces(); note("Sample data removed."); router.replace("/app"); }}>Remove sample data</button>
          <button className="text-red-600" onClick={signOut}>Sign out</button>
          <button className="text-red-600" onClick={async () => { if (prompt("This permanently deletes your account (and workspaces only you belong to). Type DELETE to confirm.") !== "DELETE") return; const { error } = await supabase.rpc("delete_account"); if (error) return alert(error.message); await signOut(); }}>Delete my account</button>
        </div></section>

      {!canManage ? (<section className={card}><p className="text-sm text-slate-500">You are <b>{role}</b> in “{ws.name}”. Only owners and admins can change workspace settings.</p>
        {role !== "owner" && <button className={btnDanger} onClick={leave}>Leave this workspace</button>}</section>) : (<>
      <section className={card}><h2 className="font-semibold">Workspace</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs">Name<input className={input} value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} /></label>
          <label className="text-xs">Currency<select className={input} value={w.currency} onChange={(e) => setW({ ...w, currency: e.target.value })}>{["₹", "$", "€", "£", "¥", "৳", "₦", "R$"].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="text-xs">Date format<select className={input} value={w.date_format} onChange={(e) => setW({ ...w, date_format: e.target.value })}>{["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="text-xs">Overall monthly budget<input className={input} type="number" value={w.monthly_budget} onChange={(e) => setW({ ...w, monthly_budget: e.target.value })} /></label>
          <label className="text-xs">Primary purchaser / report owner<input className={input} value={w.primary_purchaser} onChange={(e) => setW({ ...w, primary_purchaser: e.target.value })} /></label>
          <label className="text-xs">Organisation type<select className={input} value={w.org_type} onChange={(e) => setW({ ...w, org_type: e.target.value })}>{["Temple", "School", "Clinic", "Company", "Housing Society", "NGO"].map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        <button className={btnPrimary} onClick={saveWs}>Save changes</button>
        <div className="space-y-3 border-t pt-3"><StorageMeter used={storageUsed} /><PhotoArchive onDone={() => window.location.reload()} /></div>
        {advanced && <div className="border-t pt-3 text-sm"><div className="mb-1 font-medium">Modules (advanced)</div>
          {(["store", "chats"] as const).map((k) => <label key={k} className="mr-4 inline-flex items-center gap-1 capitalize"><input type="checkbox" checked={ws.modules?.[k] !== false} onChange={async (e) => { const { error } = await supabase.from("workspaces").update({ modules: { ...ws.modules, [k]: e.target.checked } }).eq("id", ws.id); if (error) return alert(error.message); await reloadWorkspaces(); }} />{k}</label>)}</div>}</section>

      <section className={card}><h2 className="font-semibold">People (who paid / received from)</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(supabase.from("people").insert({ workspace_id: ws.id, name: pName.trim() })); setPName(""); }}>
          <input className={input} placeholder="Add name" value={pName} onChange={(e) => setPName(e.target.value)} required /><button className={btnPrimary}>Add</button></form>
        <div className="flex flex-wrap gap-2">{people.map((p) => <span key={p.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">{p.name}<button className="text-slate-400 hover:text-red-600" onClick={() => confirm(`Remove ${p.name}?`) && run(supabase.from("people").delete().eq("id", p.id))}>×</button></span>)}</div></section>

      <section className={card}><h2 className="font-semibold">Members &amp; permissions</h2>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(supabase.rpc("add_member", { p_ws: ws.id, p_email: mEmail, p_role: mRole }), "Member added."); setMEmail(""); }}>
          <input className={`${input} !w-64`} type="email" placeholder="Their sign-up email" value={mEmail} onChange={(e) => setMEmail(e.target.value)} required />
          <select className={`${input} !w-32`} value={mRole} onChange={(e) => setMRole(e.target.value as Role)}>{["admin", "editor", "viewer"].map((r) => <option key={r}>{r}</option>)}</select><button className={btnPrimary}>Add member</button></form>
        <p className="text-xs text-slate-500">Editors add &amp; edit their own entries; viewers read only. Admins/owners see everything. For editors and viewers choose what they may see and download:</p>
        {members.map((m) => (<div key={m.user_id} className="flex flex-wrap items-center gap-3 border-t py-2 text-sm">
          <div className="min-w-48 flex-1">{m.profiles?.full_name}<div className="text-xs text-slate-500">{m.profiles?.email}</div></div>
          {m.role === "owner" ? <span className="text-xs font-medium text-indigo-700">owner</span> : (<>
            <select className={`${input} !w-28`} value={m.role} onChange={(e) => run(supabase.from("members").update({ role: e.target.value }).eq("workspace_id", ws.id).eq("user_id", m.user_id))}>{["admin", "editor", "viewer"].map((r) => <option key={r}>{r}</option>)}</select>
            {(m.role === "editor" || m.role === "viewer") && (<>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={m.see_all} onChange={(e) => run(supabase.from("members").update({ see_all: e.target.checked }).eq("workspace_id", ws.id).eq("user_id", m.user_id))} />See whole workspace</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={m.can_download} onChange={(e) => run(supabase.from("members").update({ can_download: e.target.checked }).eq("workspace_id", ws.id).eq("user_id", m.user_id))} />Can download</label></>)}
            <button className={btnDanger} onClick={() => confirm("Remove member?") && run(supabase.from("members").delete().eq("workspace_id", ws.id).eq("user_id", m.user_id))}>×</button></>)}
        </div>))}</section>

      <section className={card}><h2 className="font-semibold">Categories, items &amp; monthly limits</h2>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(supabase.from("categories").insert({ workspace_id: ws.id, name: cName.trim(), kind: cKind })); setCName(""); }}>
          <input className={`${input} !w-56`} placeholder="New category" value={cName} onChange={(e) => setCName(e.target.value)} required />
          <select className={`${input} !w-32`} value={cKind} onChange={(e) => setCKind(e.target.value as "expense" | "income")}><option value="expense">Expense</option><option value="income">Income</option></select><button className={btnPrimary}>Add category</button></form>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!iCat) return; run(supabase.from("items").insert({ workspace_id: ws.id, category_id: iCat, name: iName.trim() })); setIName(""); }}>
          <select className={`${input} !w-56`} value={iCat} onChange={(e) => setICat(e.target.value)} required><option value="">Category…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input className={`${input} !w-56`} placeholder="New item" value={iName} onChange={(e) => setIName(e.target.value)} required /><button className={btnGhost}>Add item</button></form>
        {(["expense", "income"] as const).map((k) => (<div key={k}><div className="mt-2 text-xs font-semibold uppercase text-slate-500">{k} categories</div>
          {categories.filter((c) => c.kind === k).map((c) => (<div key={c.id} className="border-t py-2 text-sm">
            <div className="flex items-center gap-2"><b className="flex-1">{c.name}</b>
              {k === "expense" && <input className={`${input} !w-32`} type="number" placeholder="Monthly limit" defaultValue={c.monthly_limit ?? ""} onBlur={(e) => lim(e.target.value) !== c.monthly_limit && run(supabase.from("categories").update({ monthly_limit: lim(e.target.value) }).eq("id", c.id))} />}
              <button className={btnDanger} onClick={() => confirm(`Delete “${c.name}” and its items?`) && run(supabase.from("categories").delete().eq("id", c.id))}>×</button></div>
            {items.filter((i) => i.category_id === c.id).map((i) => (<div key={i.id} className="ml-4 mt-1 flex items-center gap-2 text-slate-600"><span className="flex-1">{i.name}</span>
              {k === "expense" && <input className={`${input} !w-28`} type="number" placeholder="Limit" defaultValue={i.monthly_limit ?? ""} onBlur={(e) => lim(e.target.value) !== i.monthly_limit && run(supabase.from("items").update({ monthly_limit: lim(e.target.value) }).eq("id", i.id))} />}
              <button className="text-slate-400 hover:text-red-600" onClick={() => run(supabase.from("items").delete().eq("id", i.id))}>×</button></div>))}</div>))}</div>))}
        <span className="hidden">{catName(null)}</span></section>

      <section className={card}><h2 className="font-semibold">Import from Excel</h2>
        <p className="text-xs text-slate-500">Columns: Bill Date, Type, Category, Item, Member, Mode, Status, Note, Amount. Missing categories, items and people are created automatically.</p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && importXlsx(e.target.files[0])} className="text-sm" /></section>

      <section className={`${card} border-red-200`}><h2 className="font-semibold text-red-600">Danger zone</h2>
        {role === "owner" ? <button className={btnDanger} onClick={delWs}>Delete this workspace</button> : <button className={btnDanger} onClick={leave}>Leave this workspace</button>}</section></>)}
    </div>
  );
}
