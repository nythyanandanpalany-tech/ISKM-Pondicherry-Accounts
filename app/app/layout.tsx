"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import AuthProvider, { useAuth } from "@/components/AuthProvider";
import WorkspaceProvider, { useWs } from "@/components/WorkspaceProvider";
import { supabase } from "@/lib/supabase";
import { useChatUnread } from "@/lib/useChatUnread";
import Tour from "@/components/Tour";

function Shell({ children }: { children: React.ReactNode }) {
  const { profile, advanced, signOut } = useAuth();
  const { ws, workspaces, switchTo, reloadWorkspaces, canManage, role } = useWs();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const chatsOn = ws.modules?.chats !== false, storeOn = ws.modules?.store !== false;
  const unread = useChatUnread(profile.id, chatsOn, ws.id);
  const tabs = [
    ["/app", "Dashboard"], ...(chatsOn ? [["/app/chats", "Chats"]] : []), ["/app/ledger", "Ledger"], ["/app/analytics", "Analytics"], ["/app/claims", "Claims"],
    ...(storeOn ? [["/app/store", "Store"]] : []), ...(advanced ? [["/app/bills", "All Bills"]] : []),
    ...(canManage ? [["/app/bank", "Bank Statement"], ["/app/reconcile", "Reconcile"]] : []),
  ];
  async function newWs() {
    const name = prompt("New workspace name?"); if (!name) return;
    const { data, error } = await supabase.rpc("create_workspace", { p_name: name });
    if (error) return alert(error.message);
    await reloadWorkspaces(); switchTo(data as string);
  }
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-40 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/app" className="font-bold text-indigo-700">ExpenseFlow</Link>
          <select value={ws.id} onChange={(e) => e.target.value === "__new" ? newWs() : switchTo(e.target.value)}
            className="max-w-[10rem] truncate rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm sm:max-w-xs">
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            <option value="__new">+ New workspace</option>
          </select>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
            {tabs.map(([href, label]) => {
              const active = href === "/app" ? path === href : path.startsWith(href);
              return <Link key={href} href={href} className={`whitespace-nowrap rounded-lg px-3 py-1.5 ${active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}>{label}{href === "/app/chats" && unread > 0 && <span className="ml-1 rounded-full bg-indigo-600 px-1.5 text-xs text-white">{unread}</span>}</Link>;
            })}
          </nav>
          <div className="relative">
            <button onClick={() => setMenu(!menu)} className="rounded-lg px-2 py-1 text-xl hover:bg-slate-100" aria-label="Menu">☰</button>
            {menu && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border bg-white p-1 text-sm shadow-lg" onClick={() => setMenu(false)}>
                <div className="border-b px-3 py-2 text-xs text-slate-500">{profile.full_name}<br />{profile.email} · {role}</div>
                <Link className="block rounded px-3 py-2 hover:bg-slate-50" href="/app/settings">Settings</Link>
                <Link className="block rounded px-3 py-2 hover:bg-slate-50" href="/app/help">Help &amp; support</Link>
                <Link className="block rounded px-3 py-2 hover:bg-slate-50" href="/app/help?tab=privacy">Privacy</Link>
                <button className="block w-full rounded px-3 py-2 text-left text-red-600 hover:bg-slate-50" onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <Tour />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><WorkspaceProvider><Shell>{children}</Shell></WorkspaceProvider></AuthProvider>;
}
