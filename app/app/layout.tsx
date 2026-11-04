"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import AuthProvider, { useAuth } from "@/components/AuthProvider";
import WorkspaceProvider, { useWs } from "@/components/WorkspaceProvider";
import { db, DUMMY_MODE } from "@/lib/db";
import { useChatUnread } from "@/lib/useChatUnread";
import Tour from "@/components/Tour";
import { PromptDialog } from "@/components/ui";
import { LotusBadge, MahaMantra, Wordmark } from "@/components/Brand";

function NavLinks({ tabs, path, unread, onNavigate }: { tabs: [string, string][]; path: string; unread: number; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1">
      {tabs.map(([href, label]) => {
        const active = href === "/app" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={onNavigate}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"}`}>
            {label}
            {href === "/app/chats" && unread > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-xs font-semibold text-white">{unread}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContent({ tabs, path, unread, profile, role, signOut, wsPicker, menu, setMenu, onNavigate }: {
  tabs: [string, string][]; path: string; unread: number; profile: { full_name: string | null; email: string }; role: string;
  signOut: () => void; wsPicker: React.ReactNode; menu: boolean; setMenu: (v: boolean) => void; onNavigate?: () => void;
}) {
  return (
    <>
      <Link href="/app" className="mb-5 flex items-center gap-2.5 px-2" onClick={onNavigate}>
        <LotusBadge size={36} />
        <Wordmark />
      </Link>
      <hr className="rule-gold mb-4" />
      {wsPicker}
      <div className="mb-1 mt-4 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Seva</div>
      <NavLinks tabs={tabs} path={path} unread={unread} onNavigate={onNavigate} />
      <div className="mb-1 mt-4 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">More</div>
      <nav className="mb-4 flex flex-col gap-1">
        <Link href="/app/settings" onClick={onNavigate} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">Settings</Link>
        <Link href="/app/help" onClick={onNavigate} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">Help &amp; support</Link>
      </nav>
      <div className="mt-auto pb-3"><MahaMantra /></div>
      <div className="relative border-t border-slate-200 pt-3">
        <button onClick={() => setMenu(!menu)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-50">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">{(profile.full_name || profile.email || "?")[0]?.toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-800">{profile.full_name}</span>
            <span className="block truncate text-xs text-slate-500">{profile.email}</span>
          </span>
          <span className="text-slate-400">›</span>
        </button>
        {menu && (
          <div className="absolute bottom-full left-0 mb-2 w-full rounded-lg border border-slate-200 bg-surface p-1 text-sm shadow-hover-card" onClick={() => setMenu(false)}>
            <div className="border-b border-slate-200 px-3 py-2 text-xs capitalize text-slate-500">{role}</div>
            <Link className="block rounded-md px-3 py-2 hover:bg-slate-50" href="/app/help?tab=privacy">Privacy</Link>
            <button className="block w-full rounded-md px-3 py-2 text-left text-red-600 hover:bg-slate-50" onClick={signOut}>Sign out</button>
          </div>
        )}
      </div>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { profile, advanced, signOut } = useAuth();
  const { ws, workspaces, switchTo, reloadWorkspaces, canManage, role } = useWs();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const chatsOn = ws.modules?.chats !== false, storeOn = ws.modules?.store !== false;
  const unread = useChatUnread(profile.id, chatsOn, ws.id);
  const tabs: [string, string][] = [
    ["/app", "Dashboard"], ...(chatsOn ? [["/app/chats", "Chats"] as [string, string]] : []), ["/app/ledger", "Ledger"], ["/app/analytics", "Analytics"], ["/app/claims", "Claims"],
    ...(storeOn ? [["/app/store", "Store"] as [string, string]] : []), ...(advanced ? [["/app/bills", "All Bills"] as [string, string]] : []),
    ...(canManage ? [["/app/bank", "Bank Statement"] as [string, string], ["/app/reconcile", "Reconcile"] as [string, string]] : []),
  ];
  const [newWs, setNewWs] = useState(false);
  async function createWs(name: string) {
    const { data, error } = await db.rpc("create_workspace", { p_name: name });
    if (error) throw new Error(error.message);
    setNewWs(false);
    await reloadWorkspaces(); switchTo(data as string);
  }
  const wsPicker = (
    <select value={ws.id} onChange={(e) => e.target.value === "__new" ? setNewWs(true) : switchTo(e.target.value)}
      className="mb-2 w-full truncate rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm text-slate-800">
      {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      <option value="__new">+ New workspace</option>
    </select>
  );
  return (
    <div className="flex min-h-screen bg-workspace text-slate-800">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-[250px] shrink-0 flex-col border-r border-slate-200 bg-sidebar px-4 py-6 sm:flex">
        <SidebarContent tabs={tabs} path={path} unread={unread} profile={profile} role={role} signOut={signOut} wsPicker={wsPicker} menu={menu} setMenu={setMenu} />
      </aside>

      {/* Sidebar (mobile overlay) */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 flex sm:hidden" onClick={() => setMobileNav(false)}>
          <div className="flex h-full w-[250px] flex-col border-r border-slate-200 bg-sidebar px-4 py-6" onClick={(e) => e.stopPropagation()}>
            <SidebarContent tabs={tabs} path={path} unread={unread} profile={profile} role={role} signOut={signOut} wsPicker={wsPicker} menu={menu} setMenu={setMenu} onNavigate={() => setMobileNav(false)} />
          </div>
          <div className="flex-1 bg-slate-800/40" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-[64px] items-center gap-3 border-b border-slate-200 bg-surface px-4 sm:hidden">
          <button onClick={() => setMobileNav(true)} className="rounded-md p-2 text-xl hover:bg-slate-100" aria-label="Menu">☰</button>
          <Link href="/app" className="flex min-w-0 items-center gap-2"><LotusBadge size={30} /><Wordmark size="sm" /></Link>
        </header>
        {DUMMY_MODE && (
          <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800 sm:px-8">
            Showing sample data (NEXT_PUBLIC_SEED_DUMMY_DATA=true) — not your real records. Set it to false in .env for real data.
          </div>
        )}
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
      <Tour />
      {newWs && (
        <PromptDialog title="New workspace" label="Workspace name" placeholder="e.g. Pudhuvai Vrindavanam Accounts"
          confirmLabel="Create workspace" onClose={() => setNewWs(false)} onSubmit={createWs}>
          <p>A workspace is one set of books, with its own entries, people and members. You will be its owner.</p>
        </PromptDialog>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><WorkspaceProvider><Shell>{children}</Shell></WorkspaceProvider></AuthProvider>;
}
