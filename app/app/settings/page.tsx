"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import { parseDate, num } from "@/lib/format";
import { readExcel } from "@/lib/export";
import type { Role } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { setThemePref, useThemePref, type ThemePref } from "@/components/Theme";
import { startTour } from "@/components/Tour";
import StorageMeter, { useStorageUsage } from "@/components/StorageMeter";
import PhotoArchive from "@/components/PhotoArchive";
import { useWs } from "@/components/WorkspaceProvider";
import { purgeWorkspacePhotos } from "@/lib/photos";
import { Confirm, PromptDialog, btnDanger, btnGhost, btnPrimary, input } from "@/components/ui";

const card = "rounded-lg border border-slate-200 bg-surface shadow-card p-4 space-y-3";
const lim = (v: string) => (v.trim() === "" ? null : parseFloat(v));
/** One reusable "are you sure?" so every destructive button gets a real dialog, not window.confirm. */
type Ask = { title: string; body: React.ReactNode; confirmLabel?: string; action: () => void | Promise<void> };

export default function Settings() {
  const router = useRouter();
  const { profile, advanced, reloadProfile, signOut } = useAuth();
  const theme = useThemePref();
  const [alerts, setAlerts] = useState(false);
  useEffect(() => { try { setAlerts(localStorage.getItem("ef_alerts") === "1"); } catch { /* ignore */ } }, []);
  const { ws, role, canManage, categories, items, people, members, reload, reloadWorkspaces, switchTo, workspaces, catName } = useWs();
  const storageUsed = useStorageUsage(canManage);
  const [acct, setAcct] = useState({ full_name: profile.full_name ?? "", username: profile.username ?? "" });
  const [pw, setPw] = useState(""); const [curPw, setCurPw] = useState(""); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null); const [prompting, setPrompting] = useState<null | "delWs" | "delAccount">(null);
  const [w, setW] = useState({ name: ws.name, currency: ws.currency, date_format: ws.date_format, org_type: ws.org_type, monthly_budget: ws.monthly_budget?.toString() ?? ""  , primary_purchaser: ws.primary_purchaser ?? "" });
  useEffect(() => setW({ name: ws.name, currency: ws.currency, date_format: ws.date_format, org_type: ws.org_type, monthly_budget: ws.monthly_budget?.toString() ?? "", primary_purchaser: ws.primary_purchaser ?? "" }), [ws]);
  const [pName, setPName] = useState(""); const [mEmail, setMEmail] = useState(""); const [mRole, setMRole] = useState<Role>("editor");
  const [cName, setCName] = useState(""); const [cKind, setCKind] = useState<"expense" | "income">("expense"); const [iName, setIName] = useState(""); const [iCat, setICat] = useState("");
  const note = (m: string) => { setErr(""); setMsg(m); setTimeout(() => setMsg(""), 4000); };
  const oops = (m: string) => { setMsg(""); setErr(m); };
  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok = "Saved.") => { const { error } = await p; if (error) return oops(error.message); note(ok); await reload(); };

  async function saveAccount() {
    const { error } = await db.from("profiles").update({ full_name: acct.full_name, username: acct.username.trim().toLowerCase() || null }).eq("id", profile.id);
    if (error) return oops(error.message);
    note("Account saved. Reload to see the new name.");
  }
  async function changePw() {
    if (!curPw) return oops("Enter your current password to confirm.");
    if (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return oops("New password must be at least 8 characters and include a letter and a number.");
    const { error } = await db.auth.updateUser({ password: pw, currentPassword: curPw });
    if (error) return oops(error.message);
    note("Password changed."); setPw(""); setCurPw("");
  }
  async function saveWs() {
    await run(db.from("workspaces").update({ name: w.name, currency: w.currency, date_format: w.date_format, org_type: w.org_type, monthly_budget: lim(w.monthly_budget), primary_purchaser: w.primary_purchaser || null }).eq("id", ws.id));
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
      if (cn && !cid) { const { data } = await db.from("categories").insert({ workspace_id: ws.id, name: cn, kind: type }).select().single(); if (data) { cid = data.id; cat.set(`${type}:${cn.toLowerCase()}`, cid!); } }
      const inn = (r["Item"] || "").trim(); let iid = cid && inn ? item.get(`${cid}:${inn.toLowerCase()}`) : undefined;
      if (cid && inn && !iid) { const { data } = await db.from("items").insert({ workspace_id: ws.id, category_id: cid, name: inn }).select().single(); if (data) { iid = data.id; item.set(`${cid}:${inn.toLowerCase()}`, iid!); } }
      const pn = (r["Member"] || "").trim(); let pid = pn ? ppl.get(pn.toLowerCase()) : undefined;
      if (pn && !pid) { const { data } = await db.from("people").insert({ workspace_id: ws.id, name: pn }).select().single(); if (data) { pid = data.id; ppl.set(pn.toLowerCase(), pid!); } }
      const st = (r["Status"] || "").toLowerCase();
      const { error } = await db.from("entries").insert({ workspace_id: ws.id, created_by: profile.id, type, entry_date: date, amount, category_id: cid ?? null, item_id: iid ?? null, person_id: pid ?? null,
        payment_mode: r["Mode"] || "Cash", note: r["Note"] || null, receipt_available: false, claim_status: ["submitted", "approved", "settled"].includes(st) ? st : null });
      if (error) skipped++; else ok++;
    }
    await reload(); note(`Imported ${ok} entries, skipped ${skipped}.`);
  }
  async function delWs() {
    // Photos first, while this account is still a member: the Storage policies go by membership,
    // and the database cascade does not reach into the bucket.
    const { error: photoErr } = await purgeWorkspacePhotos(ws.id);
    if (photoErr) throw new Error(`Could not remove the photos, so nothing was deleted: ${photoErr.message}`);
    const { error } = await db.from("workspaces").delete().eq("id", ws.id);
    if (error) throw new Error(error.message);
    setPrompting(null);
    await reloadWorkspaces(); const other = workspaces.find((x) => x.id !== ws.id); if (other) switchTo(other.id); router.replace("/app");
  }
  async function leave() {
    const { error } = await db.from("members").delete().eq("workspace_id", ws.id).eq("user_id", profile.id);
    if (error) throw new Error(error.message);
    await reloadWorkspaces(); router.replace("/app");
  }
  async function delAccount(password: string) {
    const { data: owned } = await db.from("members").select("workspace_id").eq("user_id", profile.id).eq("role", "owner");
    const ids = ((owned as { workspace_id: string }[]) ?? []).map((m) => m.workspace_id);
    // delete_account refuses while a workspace you own still has other members in it. Find that
    // out before touching anything, so we never clear the photos of a workspace that then survives.
    for (const id of ids) {
      const { count } = await db.from("members").select("user_id", { count: "exact", head: true }).eq("workspace_id", id).neq("user_id", profile.id);
      if (count) throw new Error("You own a workspace that has other members. Delete that workspace, or remove the members from it, first.");
    }
    for (const id of ids) await purgeWorkspacePhotos(id);
    const { error } = await db.rpc("delete_account", { p_password: password });
    if (error) throw new Error(error.message);
    await signOut();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-[24px] font-bold text-slate-800">Settings</h1>
        {msg && <span role="status" className="rounded bg-emerald-50 px-2 py-1 text-sm text-emerald-700">{msg}</span>}</div>
      {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <section className={card}><h2 className="font-semibold">My account</h2>
        <div className="grid gap-2 sm:grid-cols-3"><input className={input} placeholder="Full name" value={acct.full_name} onChange={(e) => setAcct({ ...acct, full_name: e.target.value })} />
          <input className={input} placeholder="@username" value={acct.username} onChange={(e) => setAcct({ ...acct, username: e.target.value })} /><button className={btnPrimary} onClick={saveAccount}>Save</button></div>
        <div className="flex flex-wrap gap-2">
          <input className={input} type="password" placeholder="Current password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
          <input className={input} type="password" placeholder="New password (8+ chars, letter + number)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className={btnGhost} onClick={changePw}>Change password</button>
        </div>
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
          <label className="text-xs">Appearance<select className={input} value={theme} onChange={(e) => setThemePref(e.target.value as ThemePref)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label className="text-xs">Option view<select className={input} value={advanced ? "adv" : "std"} onChange={async (e) => { const { error } = await db.from("profiles").update({ advanced: e.target.value === "adv" }).eq("id", profile.id); if (error) return oops(error.message); await reloadProfile(); }}><option value="std">Standard</option><option value="adv">Advanced (fund source, beneficiary, CSV, All Bills, modules…)</option></select></label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={alerts} onChange={async (e) => {
            if (e.target.checked) { if (!("Notification" in window)) return oops("This browser does not support notifications."); const p = await Notification.requestPermission(); if (p !== "granted") return oops("Notifications are blocked in this browser."); }
            try { localStorage.setItem("ef_alerts", e.target.checked ? "1" : "0"); } catch { /* ignore */ } setAlerts(e.target.checked); }} />Message alerts on this device</label>
          <button className={btnGhost} onClick={startTour}>Show guidelines</button>
          <button className={btnGhost} onClick={async () => { const { data, error } = await db.rpc("create_sample_workspace"); if (error) return oops(error.message); await reloadWorkspaces(); switchTo(data as string); note("Sample workspace added."); }}>Add sample workspace</button>
          <button className={btnGhost} onClick={() => setAsk({
            title: "Remove sample data", confirmLabel: "Remove it",
            body: <p>Delete the sample workspace(s) you own, with everything in them? Your real workspaces are untouched.</p>,
            action: async () => { const { error } = await db.rpc("remove_sample_data"); if (error) throw new Error(error.message); await reloadWorkspaces(); note("Sample data removed."); router.replace("/app"); },
          })}>Remove sample data</button>
          <button className="text-red-600" onClick={signOut}>Sign out</button>
          <button className="text-red-600" onClick={() => setPrompting("delAccount")}>Delete my account</button>
        </div></section>

      {!canManage ? (<section className={card}><p className="text-sm text-slate-500">You are <b>{role}</b> in “{ws.name}”. Only owners and admins can change workspace settings.</p>
        {role !== "owner" && <button className={btnDanger} onClick={() => setAsk({ title: "Leave this workspace", confirmLabel: "Leave", body: <p>Leave “{ws.name}”? You will lose access to its books until an admin adds you back. Nothing is deleted.</p>, action: leave })}>Leave this workspace</button>}</section>) : (<>
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
          {(["store", "chats"] as const).map((k) => <label key={k} className="mr-4 inline-flex items-center gap-1 capitalize"><input type="checkbox" checked={ws.modules?.[k] !== false} onChange={async (e) => { const { error } = await db.from("workspaces").update({ modules: { ...ws.modules, [k]: e.target.checked } }).eq("id", ws.id); if (error) return oops(error.message); await reloadWorkspaces(); }} />{k}</label>)}</div>}</section>

      <section className={card}><h2 className="font-semibold">People (who paid / received from)</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(db.from("people").insert({ workspace_id: ws.id, name: pName.trim() })); setPName(""); }}>
          <input className={input} placeholder="Add name" value={pName} onChange={(e) => setPName(e.target.value)} required /><button className={btnPrimary}>Add</button></form>
        <div className="flex flex-wrap gap-2">{people.map((p) => <span key={p.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">{p.name}<button className="text-slate-400 hover:text-red-600" aria-label={`Remove ${p.name}`} onClick={() => setAsk({ title: "Remove this name", confirmLabel: "Remove", body: <p>Remove <b>{p.name}</b> from the list of people? Entries already recorded against them keep their amounts but lose the name.</p>, action: () => run(db.from("people").delete().eq("id", p.id)) })}>×</button></span>)}</div></section>

      <section className={card}><h2 className="font-semibold">Members &amp; permissions</h2>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(db.rpc("add_member", { p_ws: ws.id, p_email: mEmail, p_role: mRole }), "Member added."); setMEmail(""); }}>
          <input className={`${input} !w-64`} type="email" placeholder="Their sign-up email" value={mEmail} onChange={(e) => setMEmail(e.target.value)} required />
          <select className={`${input} !w-32`} value={mRole} onChange={(e) => setMRole(e.target.value as Role)}>{["admin", "editor", "viewer"].map((r) => <option key={r}>{r}</option>)}</select><button className={btnPrimary}>Add member</button></form>
        <p className="text-xs text-slate-500">Editors add &amp; edit their own entries; viewers read only. Admins/owners see everything. For editors and viewers choose what they may see and download:</p>
        {members.map((m) => (<div key={m.user_id} className="flex flex-wrap items-center gap-3 border-t py-2 text-sm">
          <div className="min-w-48 flex-1">{m.profiles?.full_name}<div className="text-xs text-slate-500">{m.profiles?.email}</div></div>
          {m.role === "owner" ? <span className="text-xs font-medium text-indigo-700">owner</span> : (<>
            <select className={`${input} !w-28`} value={m.role} onChange={(e) => run(db.from("members").update({ role: e.target.value }).eq("workspace_id", ws.id).eq("user_id", m.user_id))}>{["admin", "editor", "viewer"].map((r) => <option key={r}>{r}</option>)}</select>
            {(m.role === "editor" || m.role === "viewer") && (<>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={m.see_all} onChange={(e) => run(db.from("members").update({ see_all: e.target.checked }).eq("workspace_id", ws.id).eq("user_id", m.user_id))} />See whole workspace</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={m.can_download} onChange={(e) => run(db.from("members").update({ can_download: e.target.checked }).eq("workspace_id", ws.id).eq("user_id", m.user_id))} />Can download</label></>)}
            <button className={btnDanger} aria-label={`Remove ${m.profiles?.full_name ?? "member"}`} onClick={() => setAsk({ title: "Remove member", confirmLabel: "Remove", body: <p>Remove <b>{m.profiles?.full_name || m.profiles?.email}</b> from “{ws.name}”? Their entries stay in the books.</p>, action: () => run(db.from("members").delete().eq("workspace_id", ws.id).eq("user_id", m.user_id)) })}>×</button></>)}
        </div>))}</section>

      <section className={card}><h2 className="font-semibold">Categories, items &amp; monthly limits</h2>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(db.from("categories").insert({ workspace_id: ws.id, name: cName.trim(), kind: cKind })); setCName(""); }}>
          <input className={`${input} !w-56`} placeholder="New category" value={cName} onChange={(e) => setCName(e.target.value)} required />
          <select className={`${input} !w-32`} value={cKind} onChange={(e) => setCKind(e.target.value as "expense" | "income")}><option value="expense">Expense</option><option value="income">Income</option></select><button className={btnPrimary}>Add category</button></form>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!iCat) return; run(db.from("items").insert({ workspace_id: ws.id, category_id: iCat, name: iName.trim() })); setIName(""); }}>
          <select className={`${input} !w-56`} value={iCat} onChange={(e) => setICat(e.target.value)} required><option value="">Category…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input className={`${input} !w-56`} placeholder="New item" value={iName} onChange={(e) => setIName(e.target.value)} required /><button className={btnGhost}>Add item</button></form>
        {(["expense", "income"] as const).map((k) => (<div key={k}><div className="mt-2 text-xs font-semibold uppercase text-slate-500">{k} categories</div>
          {categories.filter((c) => c.kind === k).map((c) => (<div key={c.id} className="border-t py-2 text-sm">
            <div className="flex items-center gap-2"><b className="flex-1">{c.name}</b>
              {k === "expense" && <input className={`${input} !w-32`} type="number" placeholder="Monthly limit" defaultValue={c.monthly_limit ?? ""} onBlur={(e) => lim(e.target.value) !== c.monthly_limit && run(db.from("categories").update({ monthly_limit: lim(e.target.value) }).eq("id", c.id))} />}
              <button className={btnDanger} aria-label={`Delete ${c.name}`} onClick={() => setAsk({ title: "Delete category", confirmLabel: "Delete", body: <p>Delete <b>{c.name}</b> and every item under it? Entries in this category keep their amounts but become uncategorised.</p>, action: () => run(db.from("categories").delete().eq("id", c.id)) })}>×</button></div>
            {items.filter((i) => i.category_id === c.id).map((i) => (<div key={i.id} className="ml-4 mt-1 flex items-center gap-2 text-slate-600"><span className="flex-1">{i.name}</span>
              {k === "expense" && <input className={`${input} !w-28`} type="number" placeholder="Limit" defaultValue={i.monthly_limit ?? ""} onBlur={(e) => lim(e.target.value) !== i.monthly_limit && run(db.from("items").update({ monthly_limit: lim(e.target.value) }).eq("id", i.id))} />}
              <button className="text-slate-400 hover:text-red-600" aria-label={`Delete ${i.name}`} onClick={() => run(db.from("items").delete().eq("id", i.id))}>×</button></div>))}</div>))}</div>))}
        <span className="hidden">{catName(null)}</span></section>

      <section className={card}><h2 className="font-semibold">Import from Excel</h2>
        <p className="text-xs text-slate-500">Columns: Bill Date, Type, Category, Item, Member, Mode, Status, Note, Amount. Missing categories, items and people are created automatically.</p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && importXlsx(e.target.files[0])} className="text-sm" /></section>

      <section className={`${card} border-red-200`}><h2 className="font-semibold text-red-600">Danger zone</h2>
        {role === "owner"
          ? <button className={btnDanger} onClick={() => setPrompting("delWs")}>Delete this workspace</button>
          : <button className={btnDanger} onClick={() => setAsk({ title: "Leave this workspace", confirmLabel: "Leave", body: <p>Leave “{ws.name}”? You will lose access to its books until an admin adds you back. Nothing is deleted.</p>, action: leave })}>Leave this workspace</button>}</section></>)}

      {ask && (
        <Confirm title={ask.title} confirmLabel={ask.confirmLabel} danger onClose={() => setAsk(null)}
          onConfirm={async () => { await ask.action(); setAsk(null); }}>{ask.body}</Confirm>
      )}
      {prompting === "delWs" && (
        <PromptDialog title="Delete this workspace" danger confirmLabel="Delete it for good"
          label="Type the workspace name to confirm" placeholder={ws.name} mustEqual={ws.name}
          onClose={() => setPrompting(null)} onSubmit={delWs}>
          <p>This deletes <b>{ws.name}</b> and everything in it — every entry, bill photo, payment screenshot, bank row, store record and its history. It cannot be undone.</p>
          <p className="text-slate-500">Export the ledger to Excel first if you may need it.</p>
        </PromptDialog>
      )}
      {prompting === "delAccount" && (
        <PromptDialog title="Delete my account" danger confirmLabel="Delete my account" password
          label="Confirm your password" onClose={() => setPrompting(null)} onSubmit={delAccount}>
          <p>This permanently deletes your account and any workspace you own on your own, including its photos. Workspaces that have other members are kept — hand those over or remove the members first.</p>
          <p className="text-slate-500">It cannot be undone.</p>
        </PromptDialog>
      )}
    </div>
  );
}
