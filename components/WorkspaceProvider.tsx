"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { db } from "@/lib/db";
import type { BankAccount, Category, Item, Member, Person, Role, Workspace } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { SUPER_ADMIN, roleLabel } from "@/lib/roles";
import { btnPrimary, input } from "./ui";

type Ctx = {
  ws: Workspace; workspaces: Workspace[]; role: Role; member: Member;
  /** On screen: "Super admin", or the workspace role's name. */
  roleName: string;
  /** Super admin: owner of every workspace, sees all users and sets their roles. */
  superAdmin: boolean;
  /** Add entries. */
  canWrite: boolean;
  /** Edit and delete entries, members and settings: owners, admins and super admins. */
  canManage: boolean;
  /** The books — journals, ledgers, bank, reconciliation, weekly settlement: canManage plus the main accountant. */
  canAccount: boolean;
  canDownload: boolean;
  categories: Category[]; items: Item[]; people: Person[]; members: Member[]; banks: BankAccount[];
  switchTo: (id: string) => void; reload: () => Promise<void>; reloadWorkspaces: () => Promise<void>;
  catName: (id: string | null) => string; itemName: (id: string | null) => string; personName: (id: string | null) => string;
  money: (n: number) => string;
};
const WsCtx = createContext<Ctx | null>(null);
export const useWs = () => useContext(WsCtx)!;

export default function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [mine, setMine] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [data, setData] = useState<{ categories: Category[]; items: Item[]; people: Person[]; members: Member[]; banks: BankAccount[] }>({ categories: [], items: [], people: [], members: [], banks: [] });
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const reloadWorkspaces = useCallback(async () => {
    const [w, m] = await Promise.all([
      db.from("workspaces").select("*").order("created_at"),
      db.from("members").select("*").eq("user_id", profile.id),
    ]);
    const list = (w.data as Workspace[]) ?? [];
    setWorkspaces(list); setMine((m.data as Member[]) ?? []); setLoaded(true);
    setCurrentId((cur) => {
      let saved: string | null = null;
      try { saved = localStorage.getItem("ef_ws"); } catch { /* ignore */ }
      return list.find((x) => x.id === cur)?.id ?? list.find((x) => x.id === saved)?.id ?? list[0]?.id ?? null;
    });
  }, [profile.id]);
  useEffect(() => { reloadWorkspaces(); }, [reloadWorkspaces]);

  const reload = useCallback(async () => {
    if (!currentId) return;
    const [c, i, p, m, bk] = await Promise.all([
      db.from("categories").select("*").eq("workspace_id", currentId).order("name"),
      db.from("items").select("*").eq("workspace_id", currentId).order("name"),
      db.from("people").select("*").eq("workspace_id", currentId).order("name"),
      db.from("members").select("*, profiles(full_name,email)").eq("workspace_id", currentId),
      db.from("bank_accounts").select("*").eq("workspace_id", currentId).order("name"),
    ]);
    setData({ categories: (c.data as Category[]) ?? [], items: (i.data as Item[]) ?? [], people: (p.data as Person[]) ?? [], members: (m.data as Member[]) ?? [], banks: (bk.data as BankAccount[]) ?? [] });
  }, [currentId]);
  useEffect(() => { reload(); }, [reload]);

  const ws = workspaces.find((w) => w.id === currentId);
  const superAdmin = !!profile.super_admin;
  // A super admin sees every workspace whether or not they were added to it, and acts as its owner there
  // (the database's ws_role() says the same), so they get a stand-in membership where they have none.
  const own = mine.find((m) => m.workspace_id === currentId);
  const member: Member | undefined = ws && superAdmin
    ? { ...(own ?? { workspace_id: ws.id, user_id: profile.id, see_all: true, can_download: true }), role: "owner" }
    : own;

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const { data: id, error } = await db.rpc("create_workspace", { p_name: name.trim() });
    if (error) return setErr(error.message);
    try { localStorage.setItem("ef_ws", id as string); } catch { /* ignore */ }
    setName(""); setCurrentId(id as string); await reloadWorkspaces();
  }

  if (!loaded) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (!ws || !member) return (
    <div className="mx-auto max-w-md p-6">
      <form onSubmit={create} className="space-y-3 rounded-lg border border-slate-200 bg-surface p-6 shadow-card">
        <h1 className="text-[24px] font-bold text-slate-800">Create your first workspace</h1>
        <p className="text-sm text-slate-500">A workspace is one set of books, e.g. “Pudhuvai Vrindavanam Accounts”. Or ask an admin to add you to theirs.</p>
        <input className={input} placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className={btnPrimary}>Create workspace</button>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </form>
    </div>
  );

  const manage = member.role === "owner" || member.role === "admin";
  const account = manage || member.role === "accountant";
  const byId = <T extends { id: string; name: string }>(l: T[], id: string | null) => l.find((x) => x.id === id)?.name ?? "";
  const fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
  return (
    <WsCtx.Provider value={{
      ws, workspaces, role: member.role, member, superAdmin, roleName: superAdmin ? SUPER_ADMIN.label : roleLabel(member.role),
      canWrite: member.role !== "viewer", canManage: manage, canAccount: account,
      canDownload: account || member.can_download, ...data,
      switchTo: (id) => { try { localStorage.setItem("ef_ws", id); } catch { /* ignore */ } setCurrentId(id); },
      reload, reloadWorkspaces,
      catName: (id) => byId(data.categories, id), itemName: (id) => byId(data.items, id), personName: (id) => byId(data.people, id),
      money: (n) => `${ws.currency}${fmt.format(n)}`,
    }}>{children}</WsCtx.Provider>
  );
}
