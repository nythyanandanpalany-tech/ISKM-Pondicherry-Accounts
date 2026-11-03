"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

type Ctx = { profile: Profile; signOut: () => Promise<void> };
const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = () => useContext(AuthCtx)!;

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.replace("/login");
      const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      if (alive && data) setProfile(data as Profile);
    }
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (!s) router.replace("/login"); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [router]);

  if (!profile) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  return (
    <AuthCtx.Provider value={{
      profile,
      signOut: async () => { await supabase.auth.signOut(); router.replace("/login"); },
    }}>{children}</AuthCtx.Provider>
  );
}
