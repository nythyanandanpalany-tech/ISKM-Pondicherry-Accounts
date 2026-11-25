"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWs } from "@/components/WorkspaceProvider";
import { btnGhost, btnPrimary, input } from "@/components/ui";
import { buildBooks } from "@/lib/accounts";
import { db } from "@/lib/db";
import { dmy } from "@/lib/format";
import { loadBooksData, type BooksData } from "@/lib/loadBooks";
import { CHECKS, checkWeek, indiaToday, statusOf, weeksSince, type BankItem, type Status, type WeekCheck, type WeekSettlementRow } from "@/lib/settlement";

const card = "rounded-lg border border-slate-200 bg-surface p-4 shadow-card";
const STATUS: Record<Status, { label: string; cls: string }> = {
  settled: { label: "Settled", cls: "bg-emerald-100 text-emerald-800" },
  changed: { label: "Settled — changed since", cls: "bg-amber-100 text-amber-800" },
  ready: { label: "Ready to settle", cls: "bg-sky-100 text-sky-800" },
  open: { label: "Not settled", cls: "bg-red-50 text-red-700" },
  running: { label: "Week in progress", cls: "bg-slate-100 text-slate-600" },
};
const Badge = ({ s }: { s: Status }) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[s].cls}`}>{STATUS[s].label}</span>;
const Tick = ({ ok, label }: { ok: boolean; label: string }) => (
  <span role="img" aria-label={`${label}: ${ok ? "done" : "not done"}`} className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-600"}`}>{ok ? "✓" : "✗"}</span>
);
const okOf = (c: WeekCheck, key: (typeof CHECKS)[number]["key"]) => c[key].ok;

/**
 * Weekly settlement: a calendar week (Monday–Sunday) is settled when the bank is matched, the cash
 * is counted, the trial balance tallies and the bills are attached. The checks come from
 * lib/settlement.ts; only the cash count and the settling are saved (week_settlements).
 */
export default function Settlement() {
  const { ws, canAccount, categories, banks, people, members } = useWs();
  // To the paisa, like the reports: a cash count 50 paise out must not read as "₹1".
  const money = useCallback((n: number) => `${ws.currency}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, [ws.currency]);
  const [data, setData] = useState<BooksData | null>(null);
  const [saved, setSaved] = useState<WeekSettlementRow[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const today = indiaToday();

  const load = useCallback(async () => {
    if (!canAccount) return;
    setLoadErr("");
    try {
      const [d, s] = await Promise.all([loadBooksData(ws.id), db.from("week_settlements").select("*").eq("workspace_id", ws.id)]);
      if (s.error) throw new Error(s.error.message);
      setData(d); setSaved((s.data as WeekSettlementRow[]) ?? []);
    } catch (e) { setLoadErr((e as Error).message); }
  }, [ws.id, canAccount]);
  useEffect(() => { setData(null); load(); }, [load]);

  const names = useMemo(() => ({
    cat: (id: string | null) => categories.find((c) => c.id === id)?.name ?? "",
    person: (id: string | null) => people.find((p) => p.id === id)?.name ?? "",
  }), [categories, people]);
  const books = useMemo(() => data && buildBooks(data.entries, { categories, banks, opening: data.opening, vouchersFrom: ws.vouchers_from }, names), [data, categories, banks, ws.vouchers_from, names]);
  const weeks = useMemo(() => weeksSince(ws.vouchers_from, today), [ws.vouchers_from, today]);
  const checks = useMemo(() => (books && data ? weeks.map((w) => checkWeek(books, data.txns, w, saved.find((s) => s.week_start === w.from), today)) : []), [books, data, weeks, saved, today]);
  // Open on the most recent week that has ended and is not settled; else the latest week.
  const current = checks.find((c) => c.week.from === sel) ?? checks.find((c) => c.ended && !c.settled) ?? checks[0];
  const who = (id: string | null) => members.find((m) => m.user_id === id)?.profiles?.full_name ?? "someone";

  if (!canAccount) return <p className="rounded-lg border border-slate-200 bg-surface p-6 text-slate-600 shadow-card">Only owners, admins and the main accountant can settle the weeks.</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-bold text-slate-800">Weekly settlement</h1>
        <p className="text-sm text-slate-500">A calendar week (Monday–Sunday) is settled when the bank is matched, the cash is counted, the trial balance tallies and the bills are attached. Settling locks nothing — entries can still be corrected, and the week will say it has changed.</p>
      </div>
      {loadErr && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load the weeks: {loadErr}. If this says a table does not exist, run <code>supabase/migrations/20260101000007_week_settlement.sql</code> in the Supabase SQL Editor.
        </p>
      )}
      {!data && !loadErr && <p className="p-6 text-center text-slate-400">Loading the weeks…</p>}

      {data && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section aria-label="Weeks" className="self-start overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-card">
            <div className="max-h-[75vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-3 py-2 text-left">Week</th>{CHECKS.map((k) => <th key={k.key} className="px-1 py-2 text-center" title={k.label}>{k.label.split(" ")[0]}</th>)}<th className="hidden px-3 py-2 text-left sm:table-cell">Status</th></tr>
                </thead>
                <tbody>
                  {checks.map((c) => {
                    const active = c.week.from === current?.week.from;
                    return (
                      <tr key={c.week.from} onClick={() => setSel(c.week.from)} aria-selected={active}
                        className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${active ? "bg-indigo-50" : ""}`}>
                        <td className="px-3 py-2"><button className="whitespace-nowrap text-left font-medium text-slate-800" aria-label={`${dmy(c.week.from)} – ${dmy(c.week.to)}`} onClick={() => setSel(c.week.from)}>{dmy(c.week.from).slice(0, 5)} – {dmy(c.week.to)}</button><div className="mt-1 sm:hidden"><Badge s={statusOf(c)} /></div></td>
                        {CHECKS.map((k) => <td key={k.key} className="px-1 py-2 text-center"><Tick ok={okOf(c, k.key)} label={k.label} /></td>)}
                        <td className="hidden px-3 py-2 sm:table-cell"><Badge s={statusOf(c)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          {current && <WeekDetail key={current.week.from} c={current} row={saved.find((s) => s.week_start === current.week.from)} wsId={ws.id} money={money} who={who} onChanged={load} />}
        </div>
      )}
    </div>
  );
}

function WeekDetail({ c, row, wsId, money, who, onChanged }: {
  c: WeekCheck; row: WeekSettlementRow | undefined; wsId: string; money: (n: number) => string; who: (id: string | null) => string; onChanged: () => void;
}) {
  const [count, setCount] = useState(row?.cash_counted == null ? "" : String(row.cash_counted));
  const [note, setNote] = useState(row?.cash_note ?? "");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const status = statusOf(c);
  const title = `Week ${dmy(c.week.from)} – ${dmy(c.week.to)}`;

  async function act(job: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true); setErr("");
    const { error } = await job();
    setBusy(false);
    if (error) setErr(error.message); else onChanged();
  }
  const saveCount = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(count.replace(/,/g, "").trim());
    if (count.trim() === "" || !Number.isFinite(n) || n < 0) return setErr("Enter the cash counted, in rupees (0 or more).");
    act(() => db.from("week_settlements").upsert({ workspace_id: wsId, week_start: c.week.from, cash_counted: Math.round(n * 100) / 100, cash_note: note.trim() || null }, { onConflict: "workspace_id,week_start" }));
  };
  const settle = () => act(() => db.from("week_settlements").update({ settled_at: new Date().toISOString(), snapshot: { fingerprint: c.fingerprint } }).eq("workspace_id", wsId).eq("week_start", c.week.from));
  const undo = () => act(() => db.from("week_settlements").update({ settled_at: null }).eq("workspace_id", wsId).eq("week_start", c.week.from));

  const items = (rows: BankItem[], empty: string) => rows.length ? (
    <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start justify-between gap-3 px-3 py-1.5">
          <span className="min-w-0 flex-1">
            <span className="block text-slate-500">{dmy(r.date)}{r.voucherNo && <span className="ml-2 font-mono text-xs text-slate-700">{r.voucherNo}</span>}</span>
            <span className="block text-slate-700">{r.text}</span>
          </span>
          <span className="whitespace-nowrap tabular-nums">{r.direction === "in" ? "+" : "−"}{money(r.amount)}</span>
        </li>
      ))}
    </ul>
  ) : <p className="text-sm text-slate-500">{empty}</p>;
  const head = (label: string, ok: boolean, summary: string) => (
    <div className="flex items-start gap-3"><Tick ok={ok} label={label} /><div><h3 className="font-semibold text-slate-800">{label}</h3><p className="text-sm text-slate-500">{summary}</p></div></div>
  );

  return (
    <section aria-label={title} className="space-y-3">
      <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <h2 className="font-display text-lg font-bold text-slate-800">{title}</h2>
          <div className="mt-1"><Badge s={status} /></div>
          {c.settled && row?.settled_at && <p className="mt-1 text-xs text-slate-500">Settled by {who(row.settled_by)} on {dmy(row.settled_at.slice(0, 10))}.</p>}
          {status === "changed" && <p role="alert" className="mt-1 text-sm text-amber-800">{c.ready ? "Vouchers of this week, or the cash book, changed after it was settled. Check it and settle it again." : "Since it was settled, a check no longer passes — see below."}</p>}
          {!c.ended && <p className="mt-1 text-xs text-slate-500">This week can be settled from its Sunday, {dmy(c.week.to)}.</p>}
          {c.ended && !c.ready && (!c.settled || c.changed) && <p className="mt-1 text-xs text-slate-500">All four checks below must pass before the week can be settled.</p>}
        </div>
        <div className="flex gap-2">
          {c.settled && <button className={btnGhost} disabled={busy} onClick={undo}>Undo settlement</button>}
          {(!c.settled || c.changed) && (
            <button className={btnPrimary} disabled={busy || !c.ready || !c.ended} onClick={settle}
              title={!c.ended ? "The week has not ended yet" : !c.ready ? "All four checks must pass first" : ""}>{c.settled ? "Settle again" : "Mark week settled"}</button>
          )}
        </div>
      </div>
      {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <div className={card}>
        {head("Bank matched", c.bank.ok, c.bank.vouchers ? `${c.bank.matched} of ${c.bank.vouchers} bank voucher(s) matched to the statement.` : "No bank vouchers this week.")}
        {!c.bank.ok && (
          <div className="mt-3 space-y-3 pl-9">
            <div><h4 className="text-xs font-semibold uppercase text-slate-500">In the books, not matched to the statement</h4>{items(c.bank.unmatchedVouchers, "None.")}</div>
            <div><h4 className="text-xs font-semibold uppercase text-slate-500">On the statement, with no entry</h4>{items(c.bank.unmatchedStatement, "None.")}</div>
            <p className="text-sm"><Link className="font-medium text-indigo-700 underline" href="/app/reconcile">Open Reconcile</Link> to match them, or <Link className="font-medium text-indigo-700 underline" href="/app/bank">import the bank statement</Link> for this week.</p>
          </div>
        )}
      </div>

      <div className={card}>
        {head("Cash counted", c.cash.ok, `The cash book says ${money(c.cash.book)} at the end of Sunday ${dmy(c.week.to)} (all books together).`)}
        <form onSubmit={saveCount} className="mt-3 grid gap-2 pl-9 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <label className="text-xs text-slate-500">Cash counted (₹)
            <input className={input} inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} aria-label="Cash counted" placeholder="0.00" />
          </label>
          <label className="text-xs text-slate-500">Note (optional)
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Cash count note" placeholder="e.g. counted by the treasurer after Sunday feast" maxLength={500} />
          </label>
          <button className={btnGhost} disabled={busy}>Save count</button>
        </form>
        {c.cash.counted != null && (
          <p className={`mt-2 pl-9 text-sm ${c.cash.ok ? "text-emerald-700" : "text-red-700"}`}>
            {c.cash.ok ? "The count agrees with the cash book." : `The count is ${money(Math.abs(c.cash.difference!))} ${c.cash.difference! > 0 ? "more" : "less"} than the cash book. Find the missing entry, or record the difference with a voucher, then count again.`}
            {row?.counted_at && <span className="ml-1 text-slate-500">Counted by {who(row.counted_by)} on {dmy(row.counted_at.slice(0, 10))}.</span>}
          </p>
        )}
      </div>

      <div className={card}>
        {head("Trial balance tallies", c.tb.ok, c.tb.ok ? "Every book's trial balance tallies for the week." : "A trial balance does not tally.")}
        <table className="mt-3 w-full text-sm sm:ml-9 sm:w-[calc(100%-2.25rem)]">
          <thead className="text-xs uppercase text-slate-500"><tr><th className="py-1 text-left">Book</th><th className="py-1 text-right">Debits</th><th className="py-1 text-right">Credits</th><th className="py-1 text-right">Tallies</th></tr></thead>
          <tbody>{c.tb.books.map((t) => (
            <tr key={t.scope} className="border-t border-slate-100"><td className="py-1">{t.label}</td><td className="py-1 text-right tabular-nums">{money(t.dr)}</td><td className="py-1 text-right tabular-nums">{money(t.cr)}</td><td className="py-1 text-right">{t.balanced ? "Yes" : <b className="text-red-700">No</b>}</td></tr>
          ))}</tbody>
        </table>
        {c.tb.openingDiff && <p className="mt-2 pl-9 text-sm text-red-700">The opening balances do not tally. Correct them in <Link className="font-medium underline" href="/app/accounts">Accounts → Setup</Link>.</p>}
      </div>

      <div className={card}>
        {head("Bills attached", c.bills.ok, c.bills.waiting.length ? `${c.bills.waiting.length} expense(s) are waiting for their bill.` : "Every expense that has a bill has it attached.")}
        {c.bills.waiting.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm sm:ml-9">
            {c.bills.waiting.map((e) => <li key={e.id} className="flex justify-between gap-3 px-3 py-1.5"><span><span className="text-slate-500">{dmy(e.entry_date)}</span> <span className="whitespace-nowrap font-mono text-xs">{e.voucher_no}</span> {e.note}</span><span className="tabular-nums">{money(e.amount)}</span></li>)}
          </ul>
        )}
        {c.bills.waiting.length > 0 && <p className="mt-2 text-sm sm:pl-9">Upload them from the <Link className="font-medium text-indigo-700 underline" href="/app/ledger">Ledger</Link>.</p>}
        {c.bills.selfVouchers.length > 0 && <p className="mt-2 text-sm text-slate-500 sm:pl-9">{c.bills.selfVouchers.length} self-voucher(s) flagged “No bill” — allowed, and listed on the Bills-missing list for the auditor.</p>}
      </div>
    </section>
  );
}
