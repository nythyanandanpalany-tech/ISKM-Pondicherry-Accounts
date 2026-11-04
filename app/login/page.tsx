"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db, configured } from "@/lib/db";
import { input, btnPrimary } from "@/components/ui";
import { brand } from "@/lib/brand";
import { today } from "@/lib/format";
import { verseOfTheDay, type Verse } from "@/lib/verses";
import { LotusMark, MandalaWatermark, MahaMantra, Wordmark } from "@/components/Brand";
import { VerseHero } from "@/components/Verse";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<"error" | "success">("error");
  const [busy, setBusy] = useState<"" | "signin" | "magic" | "forgot">("");
  const [remember, setRemember] = useState(true);
  const [verse, setVerse] = useState<Verse | null>(null);

  useEffect(() => setVerse(verseOfTheDay(today())), []);
  useEffect(() => {
    db.auth.completeEmailLink().then((r) => { if (r.signedIn) router.replace("/app"); else if (r.error) setMsg(r.error.message); });
    db.auth.getSession().then(({ data: { session } }) => { if (session) router.replace("/app"); });
  }, [router]);
  function fail(message: string) { setMsgKind("error"); setMsg(message); }
  function ok(message: string) { setMsgKind("success"); setMsg(message); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy("signin"); setMsg("");
    const res = mode === "in"
      ? await db.auth.signInWithPassword({ email, password, remember })
      : await db.auth.signUp({ email, password, options: { data: { full_name: name } } });
    setBusy("");
    if (res.error) return fail(res.error.message);
    if (res.data.session) router.replace("/app");
    else ok("Check your email to confirm your account, then sign in.");
  }
  async function magic() {
    if (!email) return fail("Enter your email first.");
    setBusy("magic"); setMsg("");
    const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/app` } });
    setBusy("");
    if (error) fail(error.message); else ok("Magic link sent. Check your email.");
  }
  async function forgotPassword() {
    if (!email) return fail("Enter your email above first.");
    setBusy("forgot"); setMsg("");
    const { error } = await db.auth.requestPasswordReset({ email });
    setBusy("");
    if (error) fail(error.message); else ok("Password reset link sent. Check your email.");
  }

  return (
    <div className="flex min-h-screen bg-workspace">
      {/* Devotional hero — Vrindavan night with a lotus mandala behind the verse */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-night p-10 text-white lg:flex">
        <MandalaWatermark className="pointer-events-none absolute -right-32 -bottom-24 h-[480px] w-[480px] text-saffron opacity-[0.11]" />
        <div className="relative flex items-center gap-3">
          <LotusMark size={38} />
          <Wordmark tone="light" />
        </div>
        {verse && <div className="relative"><VerseHero verse={verse} /></div>}
        <div className="relative"><MahaMantra tone="light" /></div>
      </div>

      {/* Sign-in */}
      <div className="flex flex-1 items-center justify-center p-4">
        <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-lg border border-slate-200 bg-surface p-8 shadow-card">
          <div className="mb-1 flex flex-col items-center gap-2 text-center lg:items-start lg:text-left">
            <LotusMark size={40} className="lg:hidden" />
            <h1 className="font-display text-[26px] font-bold text-slate-800">{brand.greeting} 🙏</h1>
            <p className="text-sm text-slate-500">
              Sign in to continue your seva at <span className="font-medium text-slate-700">{brand.name}</span>.
              <span className="block text-slate-400">{brand.tagline}</span>
            </p>
          </div>
          <hr className="rule-gold !my-4" />
          {!configured && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">Supabase is not configured. Copy .env.local.example to .env.local and fill it in (see README).</p>}
          {mode === "up" && <input className={input} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />}
          <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "up" ? 8 : 1} />
          {mode === "up" && <p className="text-xs text-slate-400">At least 8 characters, with a letter and a number.</p>}
          {mode === "in" && <button type="button" onClick={forgotPassword} disabled={!!busy} className="block text-sm text-indigo-600 disabled:opacity-50">{busy === "forgot" ? "Sending…" : "Forgot password?"}</button>}
          {msg && (
            <p role={msgKind === "error" ? "alert" : "status"}
              className={`rounded-md border px-3 py-2 text-sm ${msgKind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {msg}
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-500"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember me on this device</label>
          <button className={`${btnPrimary} w-full`} disabled={!!busy}>{busy === "signin" ? "Working…" : mode === "in" ? "Sign in" : "Create account"}</button>
          <button type="button" onClick={magic} disabled={!!busy} className="w-full text-sm text-indigo-600 disabled:opacity-50">{busy === "magic" ? "Sending…" : "Email me a magic link instead"}</button>
          <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="w-full text-sm text-slate-500">
            {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
          <p className="pt-2 text-center text-[11px] text-slate-400">For sevaks of {brand.legalName}</p>
        </form>
      </div>
    </div>
  );
}
