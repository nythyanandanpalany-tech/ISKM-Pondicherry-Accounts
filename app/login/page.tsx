"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, configured } from "@/lib/supabase";
import { input, btnPrimary } from "@/components/ui";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg("");
    const res = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    setBusy(false);
    if (res.error) return setMsg(res.error.message);
    if (res.data.session) router.replace("/app");
    else setMsg("Check your email to confirm your account, then sign in.");
  }
  async function magic() {
    if (!email) return setMsg("Enter your email first.");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/app` } });
    setMsg(error ? error.message : "Magic link sent. Check your email.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-indigo-700">ExpenseFlow</h1>
        <p className="text-sm text-slate-500">Track expenses. Match every payment to its bill.</p>
        {!configured && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">Supabase is not configured. Copy .env.local.example to .env.local and fill it in.</p>}
        {mode === "up" && <input className={input} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />}
        <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        <button className={`${btnPrimary} w-full`} disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</button>
        <button type="button" onClick={magic} className="w-full text-sm text-indigo-600">Email me a magic link instead</button>
        {msg && <p className="text-sm text-slate-600">{msg}</p>}
        <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="w-full text-sm text-slate-500">
          {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
