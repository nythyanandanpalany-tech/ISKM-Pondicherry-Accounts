"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile, Role } from "@/lib/types";
import { useLookups } from "@/lib/useLookups";
import { useAuth } from "@/components/AuthProvider";
import { btnDanger, btnPrimary, input } from "@/components/ui";

export default function Settings() {
  const { isStaff, isAdmin, profile } = useAuth();
  const { categories, accounts, refresh } = useLookups();
  const [cat, setCat] = useState(""); const [acc, setAcc] = useState(""); const [accType, setAccType] = useState("bank");
  const [users, setUsers] = useState<Profile[]>([]);
  const loadUsers = useCallback(() => { if (isStaff) supabase.from("profiles").select("*").order("created_at").then(({ data }) => setUsers((data as Profile[]) ?? [])); }, [isStaff]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const add = async (table: string, row: object, reset: () => void) => { const { error } = await supabase.from(table).insert(row); if (error) alert(error.message); else { reset(); refresh(); } };
  const del = async (table: string, id: string) => { if (!confirm("Delete?")) return; const { error } = await supabase.from(table).delete().eq("id", id); if (error) alert(error.message); refresh(); };

  if (!isStaff) return <div className="text-sm text-slate-500">Signed in as {profile.email} ({profile.role}). Only accountants and admins can change settings.</div>;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Categories</h2>
          <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add("categories", { name: cat }, () => setCat("")); }}>
            <input className={input} placeholder="New category" value={cat} onChange={(e) => setCat(e.target.value)} required /><button className={btnPrimary}>Add</button></form>
          {categories.map((c) => <div key={c.id} className="flex items-center justify-between border-t py-1.5 text-sm">{c.name}<button className={btnDanger} onClick={() => del("categories", c.id)}>×</button></div>)}
        </section>
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Accounts</h2>
          <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add("accounts", { name: acc, type: accType }, () => setAcc("")); }}>
            <input className={input} placeholder="New account" value={acc} onChange={(e) => setAcc(e.target.value)} required />
            <select className={`${input} !w-28`} value={accType} onChange={(e) => setAccType(e.target.value)}>{["bank", "cash", "upi", "card"].map((t) => <option key={t}>{t}</option>)}</select>
            <button className={btnPrimary}>Add</button></form>
          {accounts.map((c) => <div key={c.id} className="flex items-center justify-between border-t py-1.5 text-sm">{c.name} <span className="text-xs text-slate-400">{c.type}</span><button className={btnDanger} onClick={() => del("accounts", c.id)}>×</button></div>)}
        </section>
      </div>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-semibold">Users {isAdmin ? "" : "(only an admin can change roles)"}</h2>
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between border-t py-2 text-sm">
            <div>{u.full_name}<div className="text-xs text-slate-500">{u.email}</div></div>
            <select className={`${input} !w-36`} disabled={!isAdmin || u.id === profile.id} value={u.role}
              onChange={async (e) => { await supabase.from("profiles").update({ role: e.target.value as Role }).eq("id", u.id); loadUsers(); }}>
              <option value="member">member</option><option value="accountant">accountant</option><option value="admin">admin</option></select>
          </div>
        ))}
      </section>
    </div>
  );
}
