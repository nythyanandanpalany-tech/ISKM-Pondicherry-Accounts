"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthProvider, { useAuth } from "@/components/AuthProvider";

function Shell({ children }: { children: React.ReactNode }) {
  const { profile, isStaff, signOut } = useAuth();
  const path = usePathname();
  const nav = [
    ["/app", "Dashboard"], ["/app/expenses", "Expenses"],
    ...(isStaff ? [["/app/transactions", "Bank Statement"], ["/app/reconcile", "Reconcile"]] : []),
    ["/app/reports", "Reports"], ["/app/settings", "Settings"],
  ];
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-40 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/app" className="font-bold text-indigo-700">ExpenseFlow</Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
            {nav.map(([href, label]) => {
              const active = href === "/app" ? path === href : path.startsWith(href);
              return <Link key={href} href={href} className={`whitespace-nowrap rounded-lg px-3 py-1.5 ${active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>;
            })}
          </nav>
          <div className="hidden text-right text-xs text-slate-500 sm:block">{profile.full_name}<br />{profile.role}</div>
          <button onClick={signOut} className="text-sm text-slate-500 hover:text-slate-900">Sign out</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><Shell>{children}</Shell></AuthProvider>;
}
