"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import type { Profile } from "@/lib/types";

type Ctx = { profile: Profile; advanced: boolean; reloadProfile: () => Promise<void>; signOut: () => Promise<void> };
const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = () => useContext(AuthCtx)!;

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

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
      const { data } = await db.from("profiles").select("*").eq("id", session.user.id).single();
      if (alive && data) setProfile(data as Profile);
    }
    load();
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => { if (!s) router.replace("/login"); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [router]);

  if (!profile) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  return (
    <AuthCtx.Provider value={{
      profile, advanced: !!profile.advanced, reloadProfile,
      signOut: async () => { await db.auth.signOut(); router.replace("/login"); },
    }}>{children}</AuthCtx.Provider>
  );
}
