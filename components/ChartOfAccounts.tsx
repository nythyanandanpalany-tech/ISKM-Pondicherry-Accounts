"use client";
import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/db";
import { useWs } from "./WorkspaceProvider";
import { Confirm, btnGhost, btnPrimary, input } from "./ui";

type Line = { ord: number; grp: "income" | "expense" | "capital" | "asset" | "liability"; name: string; kind: string | null; book: string | null; is_capital: boolean; present: boolean; approved_at: string | null; approved_by: string | null };
type Other = { id: string; name: string; kind: "income" | "expense"; entries: number };

const GROUPS: [Line["grp"], string][] = [["income", "Income"], ["expense", "Expenses (running)"], ["capital", "Capital (not charged to expenses)"], ["asset", "Assets"], ["liability", "Liabilities / capital"]];
const BOOK: Record<string, string> = { temple: "Temple", goshala: "Goshala", books: "Books" };
const card = "rounded-lg border border-slate-200 bg-surface p-5 shadow-card";

/**
 * The chart of accounts from the FY2025-26 final accounts (supabase: chart_of_accounts()). A super admin
 * approves it, which creates its heads in their books; heads from before can then be merged into the
 * chart's, taking their vouchers with them. Everyone who can open Setup sees it.
 */
export default function ChartOfAccounts({ onChanged }: { onChanged: () => void }) {
  const { ws, superAdmin, categories, reload } = useWs();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [others, setOthers] = useState<Other[]>([]);
  const [into, setInto] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<null | { kind: "approve" } | { kind: "merge"; from: Other; to: string }>(null);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [c, o] = await Promise.all([db.rpc("chart_status", { p_ws: ws.id }), db.rpc("chart_other_heads", { p_ws: ws.id })]);
    if (c.error) return setErr(c.error.message);
    setLines((c.data as Line[]) ?? []); setOthers((o.data as Other[]) ?? []);
  }, [ws.id]);
  useEffect(() => { load(); }, [load]);

  if (!lines) return <section className={card}><p className="text-sm text-slate-500">Loading the chart of accounts…</p></section>;
  const approvedAt = lines[0]?.approved_at, approvedBy = lines[0]?.approved_by;
  const missing = lines.filter((l) => !l.present).length;
  const chartHeads = (kind: string) => categories.filter((c) => c.kind === kind && lines.some((l) => l.kind === kind && l.name.toLowerCase() === c.name.toLowerCase()));
  // A new action clears the last one's message, so the screen never shows a stale result.
  const askFor = (a: NonNullable<typeof ask>) => { setMsg(""); setErr(""); setAsk(a); };
  const done = async (text: string) => { setErr(""); setMsg(text); await Promise.all([load(), reload()]); onChanged(); };

  return (
    <section className={card} aria-label="Chart of accounts">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-800">Chart of accounts</h2>
          <p className="mt-1 text-xs text-slate-500">From the FY2025-26 final accounts.</p>
        </div>
        <span data-testid="chart-state" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${approvedAt ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {approvedAt ? `Approved ${new Date(approvedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}${approvedBy ? ` by ${approvedBy}` : ""}` : "Draft — awaiting super admin approval"}
        </span>
      </div>
      {msg && <p role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">{msg}</p>}
      {err && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {GROUPS.map(([g, label]) => (
          <div key={g}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
            <ul className="space-y-0.5 text-sm">
              {lines.filter((l) => l.grp === g).map((l) => (
                <li key={l.ord} className="flex items-baseline justify-between gap-2" data-testid={`chart-${l.name}`}>
                  <span className={l.present ? "text-slate-800" : "text-slate-500"}>{l.present ? "✓" : "＋"} {l.name}</span>
                  {l.book && <span className="shrink-0 text-xs text-slate-400">{BOOK[l.book]}</span>}
                </li>))}
            </ul>
          </div>))}
      </div>

      {superAdmin ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <button className={btnPrimary} onClick={() => askFor({ kind: "approve" })}>{approvedAt ? (missing ? `Apply again (${missing} missing)` : "Re-apply the chart") : "Approve the chart of accounts"}</button>
          <span className="text-xs text-slate-500">{missing ? `${missing} line${missing === 1 ? "" : "s"} marked ＋ will be added; heads already here are put in their book.` : "Every line is in this workspace."}</span>
        </div>
      ) : !approvedAt && <p className="mt-4 border-t border-slate-200 pt-4 text-xs text-slate-500">A super admin approves the chart; until then the heads stay as they are.</p>}

      {approvedAt && others.length > 0 && (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="font-semibold text-slate-800">Heads outside the chart</h3>
          <p className="mb-2 text-xs text-slate-500">{superAdmin ? "Merge each into a chart head: its vouchers move across with their numbers unchanged, and the old head is removed." : "A super admin can merge these into the chart's heads."}</p>
          <ul className="divide-y divide-slate-200 text-sm">
            {others.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 py-2" data-testid={`other-${o.name}`}>
                <span className="min-w-48 flex-1">{o.name} <span className="text-xs text-slate-400">{o.kind} · {o.entries} voucher{o.entries === 1 ? "" : "s"}</span></span>
                {superAdmin && <>
                  <select className={`${input} !w-64`} aria-label={`Merge ${o.name} into`} value={into[o.id] ?? ""} onChange={(e) => setInto({ ...into, [o.id]: e.target.value })}>
                    <option value="">Merge into…</option>
                    {chartHeads(o.kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className={btnGhost} disabled={!into[o.id]} onClick={() => askFor({ kind: "merge", from: o, to: into[o.id] })}>Merge</button>
                </>}
              </li>))}
          </ul>
        </div>
      )}

      {ask?.kind === "approve" && (
        <Confirm title="Approve the chart of accounts" confirmLabel="Approve and apply" onClose={() => setAsk(null)}
          onConfirm={async () => {
            const { data, error } = await db.rpc("approve_chart_of_accounts", { p_ws: ws.id });
            if (error) throw new Error(error.message);
            setAsk(null); await done(`Chart of accounts approved: ${data} line${data === 1 ? "" : "s"} added.`);
          }}>
          <p>This adds {missing} missing line{missing === 1 ? "" : "s"} to “{ws.name}” and puts every chart head in its book (Gaushala in Goshala, Purchase of books in Books, everything else in Temple; Construction and fixed assets as capital).</p>
          <p className="text-slate-500">Nothing is deleted. Existing vouchers keep their heads until you merge them.</p>
        </Confirm>
      )}
      {ask?.kind === "merge" && (
        <Confirm title="Merge heads" confirmLabel="Merge" danger onClose={() => setAsk(null)}
          onConfirm={async () => {
            const { data, error } = await db.rpc("merge_head", { p_from: ask.from.id, p_into: ask.to });
            if (error) throw new Error(error.message);
            const name = categories.find((c) => c.id === ask.to)?.name;
            setAsk(null); setInto({}); await done(`Merged ${ask.from.name} into ${name}: ${data} voucher${data === 1 ? "" : "s"} moved.`);
          }}>
          <p>Move all {ask.from.entries} voucher{ask.from.entries === 1 ? "" : "s"} of <b>{ask.from.name}</b> into <b>{categories.find((c) => c.id === ask.to)?.name}</b>, then remove <b>{ask.from.name}</b>?</p>
          <p className="text-slate-500">Voucher numbers do not change. Each voucher’s history records the move.</p>
        </Confirm>
      )}
    </section>
  );
}
