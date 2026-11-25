"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/db";
import type { Role } from "@/lib/types";
import { ALL_ROLES, ROLES, SUPER_ADMIN, hasFullViewSwitch, roleLabel } from "@/lib/roles";
import { useAuth } from "@/components/AuthProvider";
import { useWs } from "@/components/WorkspaceProvider";
import { Confirm, btnGhost, input } from "@/components/ui";

type Membership = { workspace_id: string; workspace: string; role: Role; see_all: boolean; can_download: boolean };
type AppUser = {
  id: string; email: string; full_name: string | null; super_admin: boolean; main_super_admin: boolean; confirmed: boolean;
  created_at: string; last_sign_in_at: string | null; memberships: Membership[];
};
type LogRow = { id: string; at: string; by_user: string | null; user_id: string | null; workspace_id: string | null; change: string };

const card = "rounded-lg border border-slate-200 bg-surface shadow-card";
const when = (t: string | null) => (t ? new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Never");
const nameOf = (u: AppUser | undefined) => u ? (u.full_name || u.email) : "—";
/** The log stores role keys ("editor"); show the names people see everywhere else ("Entry user"). */
const readable = (change: string) => change.replace(/(?<!super )\b(owner|admin|accountant|editor|viewer)\b/g, (r) => roleLabel(r));

/**
 * The super admin's screen: every user of the app, and what each may do in each workspace.
 * Everything here reads and writes through admin_* functions in the database, which refuse anyone
 * who is not a super admin — hiding the menu item is a convenience, not the safeguard.
 */
export default function AdminPage() { return <Suspense><Admin /></Suspense>; }

function Admin() {
  const { profile, reloadProfile } = useAuth();
  const { superAdmin, workspaces, reload, reloadWorkspaces } = useWs();
  const params = useSearchParams();
  const [tab, setTab] = useState<"users" | "permissions">(params.get("tab") === "permissions" ? "permissions" : "users");
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [selected, setSelected] = useState<string>(params.get("user") ?? "");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [askSuper, setAskSuper] = useState<AppUser | null>(null);

  const load = useCallback(async () => {
    const [u, l] = await Promise.all([
      db.rpc("admin_list_users"),
      db.from("role_log").select("*").order("at", { ascending: false }).limit(50),
    ]);
    if (u.error) { setErr(u.error.message); setUsers([]); return; }
    setUsers(((u.data as AppUser[]) ?? []).map((x) => ({ ...x, memberships: typeof x.memberships === "string" ? JSON.parse(x.memberships) : x.memberships ?? [] })));
    setLog((l.data as LogRow[]) ?? []);
  }, []);
  useEffect(() => { if (superAdmin) load(); }, [superAdmin, load]);

  const byId = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users ?? []).filter((u) => !s || u.email.toLowerCase().includes(s) || (u.full_name ?? "").toLowerCase().includes(s));
  }, [users, q]);
  const current = selected ? byId.get(selected) : undefined;

  if (!superAdmin) return <p className={`${card} p-6 text-slate-600`}>Only a super admin can open Users &amp; permissions.</p>;

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string, touchesMe = false) {
    setBusy(true); setErr(""); setMsg("");
    const { error } = await fn();
    setBusy(false);
    if (error) { setErr(error.message); await load(); return error.message; }
    setMsg(ok); setTimeout(() => setMsg(""), 4000);
    await load();
    if (touchesMe) { await reloadProfile(); await reloadWorkspaces(); }
    await reload();
    return null;
  }
  const setMember = (u: AppUser, wsId: string, role: Role, seeAll: boolean, canDownload: boolean) =>
    act(() => db.rpc("admin_set_member", { p_ws: wsId, p_user: u.id, p_role: role, p_see_all: seeAll, p_can_download: canDownload }),
      `Saved ${nameOf(u)}’s access.`, u.id === profile.id);
  const removeMember = (u: AppUser, wsId: string) =>
    act(() => db.rpc("admin_remove_member", { p_ws: wsId, p_user: u.id }), `Removed ${nameOf(u)} from the workspace.`, u.id === profile.id);

  const manage = (id: string) => { setSelected(id); setTab("permissions"); };
  const tabBtn = (id: typeof tab, label: string) => (
    <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === id ? "bg-indigo-600 text-white" : "border border-slate-300 bg-surface text-slate-600 hover:border-indigo-400"}`}>{label}</button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold text-slate-800">Users &amp; permissions</h1>
          <p className="text-sm text-slate-500">Everyone who has an account, and what they may do in each workspace.</p>
        </div>
        <div role="tablist" className="flex gap-2">{tabBtn("users", "Users")}{tabBtn("permissions", "Permissions")}</div>
      </div>
      {msg && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{msg}</p>}
      {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</p>}

      {tab === "users" && (
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4">
            <h2 className="font-display text-lg font-bold text-slate-800">All users {users && <span className="text-sm font-normal text-slate-500">({users.length})</span>}</h2>
            <input className={`${input} !w-64`} type="search" placeholder="Search name or email" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!users ? <p className="p-6 text-sm text-slate-500">Loading…</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr><th className="p-3">User</th><th>Access</th><th>Email</th><th>Joined</th><th>Last sign-in</th><th className="px-3" /></tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u.id} className="border-t border-slate-200 align-top" data-testid={`user-${u.email}`}>
                      <td className="p-3"><div className="font-medium text-slate-800">{u.full_name || "—"}{u.id === profile.id && <span className="ml-1 text-xs text-slate-400">(you)</span>}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                      <td className="py-3">
                        {u.super_admin && <span className="mb-1 inline-block rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">{u.main_super_admin ? "Main super admin" : SUPER_ADMIN.label}</span>}
                        {u.memberships.length === 0 && !u.super_admin && <span className="text-xs text-slate-400">No workspace yet</span>}
                        {u.memberships.map((m) => (
                          <div key={m.workspace_id} className="text-xs text-slate-600">{m.workspace} · <b>{roleLabel(m.role)}</b>{hasFullViewSwitch(m.role) && m.see_all ? " · full view" : ""}</div>
                        ))}
                      </td>
                      <td className="py-3 text-xs">{u.confirmed ? <span className="text-emerald-700">Confirmed</span> : <span className="text-amber-700">Not confirmed</span>}</td>
                      <td className="py-3 text-xs text-slate-500">{when(u.created_at)}</td>
                      <td className="py-3 text-xs text-slate-500">{when(u.last_sign_in_at)}</td>
                      <td className="px-3 py-3 text-right"><button className={btnGhost} onClick={() => manage(u.id)} aria-label={`Manage ${u.email}`}>Manage</button></td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-sm text-slate-400">No user matches “{q}”.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "permissions" && (
        <>
          <section className={`${card} space-y-3 p-4`}>
            <label className="block text-xs font-medium text-slate-600"><span className="mb-1 block">User</span>
              <select className={`${input} sm:!w-96`} aria-label="User to manage" value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Choose a user…</option>
                {(users ?? []).map((u) => <option key={u.id} value={u.id}>{nameOf(u)}{u.full_name ? ` — ${u.email}` : ""}</option>)}
              </select>
            </label>
            <ul className="grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
              <li><b className="text-slate-600">{SUPER_ADMIN.label}</b> — {SUPER_ADMIN.does}</li>
              {ALL_ROLES.map((r) => <li key={r}><b className="text-slate-600">{roleLabel(r)}</b> — {ROLES[r].does}</li>)}
              <li><b className="text-slate-600">Full view</b> — lets an entry user or viewer see the whole workspace instead of only their own entries.</li>
            </ul>
          </section>

          {current && (
            <>
              <section className={`${card} space-y-3 p-4`} aria-label="Full permissions">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-800">{nameOf(current)}</h2>
                    <p className="text-xs text-slate-500">{current.email}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={current.super_admin} disabled={busy || current.main_super_admin} onChange={() => setAskSuper(current)} />
                    {SUPER_ADMIN.label} (full permissions everywhere)
                  </label>
                </div>
                {current.main_super_admin && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800" data-testid="main-note">The main super admin always keeps full access. {current.id === profile.id ? "Your account cannot be deleted." : "Other super admins cannot change their access or delete their account."}</p>}
                {current.super_admin && <p className="rounded-md bg-indigo-50 p-2 text-xs text-indigo-800">As super admin they act as owner of every workspace, whatever is set below. The workspace roles below apply again if super admin is taken away.</p>}
              </section>

              <section className={card} aria-label="Workspace roles">
                <h2 className="border-b border-slate-200 p-4 font-semibold text-slate-800">Role in each workspace</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Workspace</th><th>Role</th><th>Full view</th><th>Can download</th></tr></thead>
                    <tbody>
                      {workspaces.map((w) => {
                        const m = current.memberships.find((x) => x.workspace_id === w.id);
                        const sw = m && hasFullViewSwitch(m.role);
                        const locked = busy || (current.main_super_admin && current.id !== profile.id);
                        return (
                          <tr key={w.id} className="border-t border-slate-200" data-testid={`perm-${w.name}`}>
                            <td className="p-3 font-medium text-slate-700">{w.name}{w.is_demo && <span className="ml-1 text-xs text-slate-400">(sample)</span>}</td>
                            <td className="py-2">
                              <select className={`${input} !w-48`} aria-label={`Role in ${w.name}`} disabled={locked} value={m?.role ?? ""}
                                onChange={(e) => {
                                  const r = e.target.value as Role | "";
                                  if (!r) { if (m) removeMember(current, w.id); return; }
                                  setMember(current, w.id, r, m?.see_all ?? false, m?.can_download ?? false);
                                }}>
                                <option value="">Not a member</option>
                                {ALL_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                              </select>
                            </td>
                            <td className="py-2">{!m ? "—" : sw
                              ? <label className="flex items-center gap-1 text-xs"><input type="checkbox" aria-label={`Full view in ${w.name}`} disabled={locked} checked={m.see_all} onChange={(e) => setMember(current, w.id, m.role, e.target.checked, m.can_download)} />On</label>
                              : <span className="text-xs text-slate-400">Always</span>}</td>
                            <td className="py-2">{!m ? "—" : sw
                              ? <label className="flex items-center gap-1 text-xs"><input type="checkbox" aria-label={`Can download in ${w.name}`} disabled={locked} checked={m.can_download} onChange={(e) => setMember(current, w.id, m.role, m.see_all, e.target.checked)} />On</label>
                              : <span className="text-xs text-slate-400">Always</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <section className={card} aria-label="Recent permission changes">
            <h2 className="border-b border-slate-200 p-4 font-semibold text-slate-800">Recent changes</h2>
            {log.length === 0 ? <p className="p-4 text-sm text-slate-400">No changes yet.</p> : (
              <ul className="divide-y divide-slate-200 text-sm">
                {log.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                    <span><b>{nameOf(byId.get(l.user_id ?? ""))}</b>{l.workspace_id ? ` in ${workspaces.find((w) => w.id === l.workspace_id)?.name ?? "a workspace"}` : ""}: {readable(l.change)}</span>
                    <span className="text-xs text-slate-500">{when(l.at)} by {nameOf(byId.get(l.by_user ?? ""))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {askSuper && (
        <Confirm title={askSuper.super_admin ? "Remove super admin" : "Make super admin"} danger={askSuper.super_admin}
          confirmLabel={askSuper.super_admin ? "Remove super admin" : "Make super admin"} onClose={() => setAskSuper(null)}
          onConfirm={async () => {
            const u = askSuper;
            const refused = await act(() => db.rpc("admin_set_super_admin", { p_user: u.id, p_on: !u.super_admin }),
              u.super_admin ? `${nameOf(u)} is no longer a super admin.` : `${nameOf(u)} is now a super admin.`, u.id === profile.id);
            if (refused) throw new Error(refused);
            setAskSuper(null);
          }}>
          {askSuper.super_admin
            ? <p>Take super admin away from <b>{nameOf(askSuper)}</b>? They keep only the workspace roles listed on this page.{askSuper.id === profile.id && " That includes you: this page will close for you."}</p>
            : <p>Give <b>{nameOf(askSuper)}</b> full permissions? They will be able to see every workspace and user, edit and delete any entry, and change anyone’s role — including yours.</p>}
        </Confirm>
      )}
    </div>
  );
}
