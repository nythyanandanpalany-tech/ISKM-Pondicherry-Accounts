"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db, configured } from "@/lib/db";
import { input, btnPrimary } from "@/components/ui";
import { LotusMark } from "@/components/Brand";

export default function ResetPassword() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // The reset email links here with a one-time code; detectSessionInUrl swaps it for a session,
  // which is what lets confirmPasswordReset below change the password without the old one.
  useEffect(() => {
    db.auth.completeEmailLink().then(async (r) => {
      if (r.signedIn) return setState("ready");
      if (r.error) { setMsg(r.error.message); return setState("invalid"); }
      const { data: { session } } = await db.auth.getSession();
      setState(session ? "ready" : "invalid");
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    if (password !== confirm) return setMsg("Passwords do not match.");
    setBusy(true);
    const { error } = await db.auth.confirmPasswordReset({ password });
    setBusy(false);
    if (error) return setMsg(error.message);
    setDone(true);
    setTimeout(() => router.replace("/app"), 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-workspace p-4">
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-slate-200 bg-surface p-8 shadow-card">
        <div className="mb-1 flex flex-col items-center gap-2 text-center">
          <LotusMark size={40} />
          <h1 className="font-display text-[26px] font-bold text-slate-800">Set a new password</h1>
        </div>
        <hr className="rule-gold !my-4" />
        {!configured && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">Supabase is not configured.</p>}

        {state === "checking" && <p className="text-center text-sm text-slate-500">Checking your reset link…</p>}

        {state === "invalid" && (
          <>
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {msg || "This reset link is invalid or has expired. Request a new one from the sign-in page."}
            </p>
            <a href="/login" className={`${btnPrimary} block w-full text-center`}>Back to sign in</a>
          </>
        )}

        {state === "ready" && !done && (
          <form onSubmit={submit} className="space-y-3">
            <input className={input} type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
            <input className={input} type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
            <p className="text-xs text-slate-400">At least 8 characters, with a letter and a number.</p>
            <button className={`${btnPrimary} w-full`} disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
            {msg && <p role="alert" className="text-sm text-red-700">{msg}</p>}
          </form>
        )}

        {done && <p role="status" className="text-center text-sm text-emerald-700">Password updated. Taking you in…</p>}
      </div>
    </div>
  );
}
