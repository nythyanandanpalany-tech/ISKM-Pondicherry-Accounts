"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import type { Profile } from "@/lib/types";
import { btnPrimary } from "@/components/ui";

type Ctx = { profile: Profile; advanced: boolean; reloadProfile: () => Promise<void>; signOut: () => Promise<void> };
const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = () => useContext(AuthCtx)!;

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [verified, setVerified] = useState(true);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  const reloadProfile = async () => {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return router.replace("/login");
    const { data } = await db.from("profiles").select("*").eq("id", session.user.id).single();
    if (data) setProfile(data as Profile);
  };
  useEffect(() => {
    let alive = true;
    async function load() {
      const { data: { session } } = await db.auth.getSession();
      if (!session) return router.replace("/login");
      setVerified(session.user.emailVerified);
      const { data } = await db.from("profiles").select("*").eq("id", session.user.id).single();
      if (alive && data) setProfile(data as Profile);
    }
    load();
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => {
      if (!s) router.replace("/login"); else setVerified(s.user.emailVerified);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [router]);

  const signOut = async () => { await db.auth.signOut(); router.replace("/login"); };

  if (!profile) return <div className="p-10 text-center text-slate-500">Loading…</div>;

  if (!verified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm space-y-3 rounded-lg border border-slate-200 bg-surface p-6 text-center shadow-card">
          <h1 className="text-[24px] font-bold text-indigo-700">Confirm your email</h1>
          <p className="text-sm text-slate-600">
            We sent a link to <b>{profile.email}</b>. Open it, then tap “I’ve confirmed” below.
          </p>
          <p className="text-xs text-slate-500">
            Until the address is confirmed you cannot create a set of books or be added to one — it is what proves the mailbox is yours.
          </p>
          <button className={`${btnPrimary} w-full`} onClick={async () => {
            setMsg(""); setErr("");
            const s = await db.auth.reloadUser();
            if (s?.user.emailVerified) setVerified(true);
            else setErr("Not confirmed yet. Check your inbox, and your spam folder.");
          }}>I’ve confirmed</button>
          <button className="w-full text-sm text-indigo-600" onClick={async () => {
            setMsg(""); setErr("");
            const { error } = await db.auth.sendVerificationEmail();
            if (error) setErr(error.message); else setMsg("Confirmation email sent.");
          }}>Resend email</button>
          {msg && <p role="status" className="text-sm text-emerald-700">{msg}</p>}
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          <button className="w-full text-sm text-slate-500" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <AuthCtx.Provider value={{ profile, advanced: !!profile.advanced, reloadProfile, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}
