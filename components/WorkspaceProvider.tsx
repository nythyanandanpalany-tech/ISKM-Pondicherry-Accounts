"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { db } from "@/lib/db";
import type { Category, Item, Member, Person, Role, Workspace } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { btnPrimary, input } from "./ui";

type Ctx = {
  ws: Workspace; workspaces: Workspace[]; role: Role; member: Member;
  canWrite: boolean; canManage: boolean; canDownload: boolean;
  categories: Category[]; items: Item[]; people: Person[]; members: Member[];
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
  const [data, setData] = useState<{ categories: Category[]; items: Item[]; people: Person[]; members: Member[] }>({ categories: [], items: [], people: [], members: [] });
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
    const [c, i, p, m] = await Promise.all([
      db.from("categories").select("*").eq("workspace_id", currentId).order("name"),
      db.from("items").select("*").eq("workspace_id", currentId).order("name"),
      db.from("people").select("*").eq("workspace_id", currentId).order("name"),
      db.from("members").select("*, profiles(full_name,email)").eq("workspace_id", currentId),
    ]);
    setData({ categories: (c.data as Category[]) ?? [], items: (i.data as Item[]) ?? [], people: (p.data as Person[]) ?? [], members: (m.data as Member[]) ?? [] });
  }, [currentId]);
  useEffect(() => { reload(); }, [reload]);

  const ws = workspaces.find((w) => w.id === currentId);
  const member = mine.find((m) => m.workspace_id === currentId);

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
  const byId = <T extends { id: string; name: string }>(l: T[], id: string | null) => l.find((x) => x.id === id)?.name ?? "";
  const fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
  return (
    <WsCtx.Provider value={{
      ws, workspaces, role: member.role, member, canWrite: member.role !== "viewer", canManage: manage,
      canDownload: manage || member.can_download, ...data,
      switchTo: (id) => { try { localStorage.setItem("ef_ws", id); } catch { /* ignore */ } setCurrentId(id); },
      reload, reloadWorkspaces,
      catName: (id) => byId(data.categories, id), itemName: (id) => byId(data.items, id), personName: (id) => byId(data.people, id),
      money: (n) => `${ws.currency}${fmt.format(n)}`,
    }}>{children}</WsCtx.Provider>
  );
}
