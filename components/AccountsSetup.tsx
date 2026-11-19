"use client";
import { useMemo, useState } from "react";
import { db } from "@/lib/db";
import { dmy } from "@/lib/format";
import { BOOKS, BOOK_ORDER } from "@/lib/accounts";
import type { Book, Category, OpeningBalance } from "@/lib/types";
import { useWs } from "./WorkspaceProvider";
import { btnGhost, btnPrimary, input } from "./ui";

const card = "rounded-lg border border-slate-200 bg-surface p-5 shadow-card";
const h2 = "font-display text-lg font-bold text-slate-800";
const small = "text-xs text-slate-500";

type OpenRow = { account: string; label: string; side: "dr" | "cr"; book?: Book };
const keyOf = (book: Book, account: string) => `${book}|${account}`;
const toNum = (s: string) => Number(s.replace(/,/g, "").trim());

/**
 * Accounts → Setup: everything the books need to know that the vouchers do not say.
 * Owners and admins only (the database enforces it). Nothing here is needed to take entries —
 * a head with no book simply stays in Temple.
 */
export default function AccountsSetup({ opening, onChanged }: { opening: OpeningBalance[]; onChanged: () => void }) {
  const { ws, categories, banks, reload } = useWs();
  const [err, setErr] = useState(""); const [saved, setSaved] = useState("");
  const fail = (e: unknown) => { setSaved(""); setErr((e as { message?: string })?.message ?? "Something went wrong."); };

  // ---------------------------------------------------------------- heads → books
  async function patch(c: Category, change: Partial<Pick<Category, "book" | "is_capital" | "section">>) {
    setErr("");
    const { error } = await db.from("categories").update(change).eq("id", c.id);
    if (error) return fail(error);
    await reload(); onChanged();
  }

  // ---------------------------------------------------------------- bank accounts
  const [newBank, setNewBank] = useState("");
  async function addBank(e: React.FormEvent) {
    e.preventDefault();
    if (!newBank.trim()) return;
    setErr("");
    const { error } = await db.from("bank_accounts").insert({ workspace_id: ws.id, name: newBank.trim() });
    if (error) return fail(error);
    setNewBank(""); await reload(); onChanged();
  }
  async function dropBank(id: string, name: string) {
    if (!confirm(`Remove the bank account “${name}”? This only works if no voucher went through it.`)) return;
    setErr("");
    const { error } = await db.from("bank_accounts").delete().eq("id", id);
    if (error) return fail(error);
    await reload(); onChanged();
  }

  // ---------------------------------------------------------------- opening balances
  const standing: OpenRow[] = useMemo(() => [
    { account: "cash", label: "Cash in hand", side: "dr" },
    ...banks.map((b): OpenRow => ({ account: `bank:${b.id}`, label: `Bank – ${b.name}`, side: "dr" })),
    { account: "loans_advances", label: "Loans & advances", side: "dr" },
    { account: "bbt_recoverable", label: "Recoverable from BBT trade book", side: "dr" },
    { account: "capital_fund", label: "Capital fund", side: "cr" },
    { account: "outstanding", label: "Outstanding expenses (bills not yet paid)", side: "cr" },
    { account: "loans_received", label: "Loans received", side: "cr" },
  ], [banks]);
  const capital: OpenRow[] = useMemo(() => categories.filter((c) => c.kind === "expense" && c.is_capital).map((c) => ({ account: `head:${c.id}`, label: `${c.name} — cost so far`, side: "dr", book: c.book })), [categories]);
  const heads: OpenRow[] = useMemo(() => categories.filter((c) => !(c.kind === "expense" && c.is_capital)).map((c) => ({ account: `head:${c.id}`, label: `${c.name} (${c.kind})`, side: c.kind === "income" ? "cr" : "dr", book: c.book })), [categories]);

  // What is saved, as the boxes show it. Built during render (not in an effect), so the boxes are
  // filled from the very first paint: typing into a box before an effect had run used to start from
  // an empty set, and saving then deleted every opening balance that had not been retyped.
  const savedVals = useMemo(() => {
    const sides = new Map([...standing, ...capital, ...heads].map((r) => [r.account, r.side]));
    const m: Record<string, string> = {};
    for (const o of opening) m[keyOf(o.book, o.account)] = String(sides.get(o.account) === "cr" ? -Number(o.amount) : Number(o.amount));
    return m;
  }, [opening, standing, capital, heads]);
  // Only what has been typed; everything else reads through to what is saved.
  const [edits, setEdits] = useState<Record<string, string>>({});
  // A fresh load replaces the drafts it now contains. Done during render (React's "adjust state when
  // a prop changes"), not in an effect, so it can never land after — and wipe — something just typed.
  const [seen, setSeen] = useState(opening);
  if (seen !== opening) { setSeen(opening); setEdits({}); }
  const vals = useMemo(() => ({ ...savedVals, ...edits }), [savedVals, edits]);

  const rowsOf = useMemo(() => [...standing, ...capital, ...heads], [standing, capital, heads]);
  const signed = (r: OpenRow, book: Book) => { const s = vals[keyOf(book, r.account)]; if (s == null || s.trim() === "") return 0; const n = toNum(s); return Number.isFinite(n) ? (r.side === "dr" ? n : -n) : 0; };
  const bookTotal = (book: Book) => Math.round(rowsOf.filter((r) => !r.book || r.book === book).reduce((s, r) => s + signed(r, book), 0) * 100) / 100;

  async function saveOpening() {
    setErr(""); setSaved("");
    const next: OpeningBalance[] = [];
    for (const r of rowsOf) for (const book of BOOK_ORDER) {
      if (r.book && r.book !== book) continue;
      const s = vals[keyOf(book, r.account)];
      if (s == null || s.trim() === "") continue;
      const n = toNum(s);
      if (!Number.isFinite(n)) return fail({ message: `“${s}” is not a number (${r.label}, ${BOOKS[book].label}).` });
      next.push({ workspace_id: ws.id, book, account: r.account, amount: r.side === "dr" ? n : -n });
    }
    const keep = new Set(next.map((o) => keyOf(o.book, o.account)));
    const gone = opening.filter((o) => !keep.has(keyOf(o.book, o.account)));
    if (next.length) { const { error } = await db.from("opening_balances").upsert(next, { onConflict: "workspace_id,book,account" }); if (error) return fail(error); }
    for (const o of gone) { const { error } = await db.from("opening_balances").delete().eq("workspace_id", ws.id).eq("book", o.book).eq("account", o.account); if (error) return fail(error); }
    setSaved("Opening balances saved."); onChanged();
  }

  const cell = (r: OpenRow, book: Book) =>
    r.book && r.book !== book ? <td key={book} className="px-2 py-1 text-center text-slate-300">—</td> : (
      <td key={book} className="px-2 py-1">
        <input className={`${input} !py-1 text-right tabular-nums`} inputMode="decimal" placeholder="0.00" aria-label={`${r.label}, ${BOOKS[book].label} book`}
          value={vals[keyOf(book, r.account)] ?? ""} onChange={(e) => { const k = keyOf(book, r.account), v = e.target.value; setEdits((d) => ({ ...d, [k]: v })); }} />
      </td>
    );
  const table = (rows: OpenRow[], caption: string) => rows.length > 0 && (
    <>
      <tr className="bg-hover"><td colSpan={5} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-gold-ink">{caption}</td></tr>
      {rows.map((r) => (
        <tr key={r.account} className="border-t border-slate-100">
          <td className="px-3 py-1 text-slate-700">{r.label}</td>
          <td className="px-2 py-1 text-xs text-slate-400">{r.side === "dr" ? "Dr" : "Cr"}</td>
          {BOOK_ORDER.map((b) => cell(r, b))}
        </tr>
      ))}
    </>
  );

  return (
    <div className="space-y-6">
      {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <section className={card}>
        <h2 className={h2}>Heads and their books</h2>
        <p className={`mt-1 ${small}`}>
          Each head is kept in one of the three books. Names with Gaushala/Goshala go to <b>Goshala</b>, Purchase of books to <b>Books</b>, everything else to <b>Temple</b> — change any of them here.
          <b> Capital</b> heads (construction, fixed assets) are assets, not expenses. <b>Construction</b> is reported as its own section of the Temple book.
          Changing a head&apos;s book moves all of its vouchers, past and future, to that book.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Head</th><th>Book</th><th className="text-center">Capital</th><th className="text-center">Construction</th></tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5"><span className="font-medium text-slate-800">{c.name}</span> <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-px text-[10px] uppercase text-slate-500">{c.kind}</span></td>
                  <td className="py-1"><select className={`${input} !w-auto !py-1`} value={c.book} aria-label={`Book for ${c.name}`} onChange={(e) => patch(c, { book: e.target.value as Book })}>{BOOK_ORDER.map((b) => <option key={b} value={b}>{BOOKS[b].label}</option>)}</select></td>
                  <td className="text-center">{c.kind === "expense" ? <input type="checkbox" className="h-4 w-4 accent-indigo-600" aria-label={`${c.name} is capital spending`} checked={c.is_capital} onChange={(e) => patch(c, { is_capital: e.target.checked })} /> : <span className="text-slate-300">—</span>}</td>
                  <td className="text-center"><input type="checkbox" className="h-4 w-4 accent-indigo-600" aria-label={`${c.name} is in the Construction section`} checked={c.section === "construction"} onChange={(e) => patch(c, { section: e.target.checked ? "construction" : null })} /></td>
                </tr>
              ))}
              {!categories.length && <tr><td colSpan={4} className="p-4 text-center text-slate-400">No heads yet — add them in Settings.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>Bank accounts</h2>
        <p className={`mt-1 ${small}`}>Bank vouchers and receipts say which account they went through, so each bank gets its own book and its own line in the trial balance and balance sheet.</p>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {banks.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-1.5"><span className="text-slate-800">{b.name}</span><button className="text-xs text-red-600 hover:underline" onClick={() => dropBank(b.id, b.name)}>Remove</button></li>
          ))}
          {!banks.length && <li className="py-2 text-slate-400">None yet. Until you add one, bank vouchers are kept under “Bank – account not chosen”.</li>}
        </ul>
        <form onSubmit={addBank} className="mt-3 flex gap-2">
          <input className={`${input} max-w-sm`} placeholder="e.g. Ujjivan Small Finance Bank" aria-label="New bank account name" value={newBank} onChange={(e) => setNewBank(e.target.value)} maxLength={80} />
          <button className={btnGhost} disabled={!newBank.trim()}>Add bank account</button>
        </form>
      </section>

      <section className={card}>
        <h2 className={h2}>Opening balances</h2>
        <p className={`mt-1 ${small}`}>
          Where each account stood on <b>{ws.vouchers_from ? dmy(ws.vouchers_from) : "the day the books start"}</b>, when the vouchers begin. Enter balances the usual way round
          (cash and bank as money held, capital fund and loans as amounts owed). The April–October totals of income and expense heads go in the second table, so a full-year
          report is complete. Leave a box empty for zero. The books work without any of this; it just starts every account at nothing.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Account</th><th /><th className="px-2 text-right">Temple</th><th className="px-2 text-right">Goshala</th><th className="px-2 text-right">Books</th></tr></thead>
            <tbody>
              {table(standing, "Cash, bank, loans and capital")}
              {table(capital, "Capital spending so far (assets)")}
              {table(heads, "April–October totals so far this financial year")}
              <tr className="border-t-2 border-slate-300 bg-slate-50 text-xs font-semibold">
                <td className="px-3 py-2" colSpan={2}>Debits less credits (should be 0.00)</td>
                {BOOK_ORDER.map((b) => <td key={b} className={`px-2 py-2 text-right tabular-nums ${bookTotal(b) === 0 ? "text-emerald-700" : "text-red-700"}`}>{bookTotal(b).toFixed(2)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className={`mt-2 ${small}`}>If a book does not tally, the gap shows as “Opening balance difference” on its reports until it is corrected — nothing breaks.</p>
        <div className="mt-3 flex items-center gap-3">
          <button className={btnPrimary} onClick={saveOpening}>Save opening balances</button>
          {saved && <span role="status" className="text-sm text-emerald-700">{saved}</span>}
        </div>
      </section>
    </div>
  );
}
