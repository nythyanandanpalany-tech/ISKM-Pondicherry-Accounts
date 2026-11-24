"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWs } from "@/components/WorkspaceProvider";
import SheetTable from "@/components/SheetTable";
import AccountsSetup from "@/components/AccountsSetup";
import { btnGhost, btnPrimary, input } from "@/components/ui";
import { buildBooks, SCOPES, type Scope } from "@/lib/accounts";
import { loadBooksData, type BooksData } from "@/lib/loadBooks";
import { addDays, monthRange, rangeFor, rangeText, type Period } from "@/lib/periods";
import { auditorPack, REPORTS, reportById } from "@/lib/sheets";
import { dmy, today } from "@/lib/format";
import type { OpeningBalance } from "@/lib/types";

const PERIODS: { id: Period; label: string }[] = [
  { id: "week", label: "Week" }, { id: "month", label: "Month" }, { id: "quarter", label: "Quarter" }, { id: "fy", label: "Financial year" }, { id: "custom", label: "Custom" },
];
/** One empty list for "not loaded yet", so Setup does not see a new array on every render. */
const NO_OPENING: OpeningBalance[] = [];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Accounts: the books and the auditor's reports.
 *
 * Journal → Ledger → Trial balance, three separate books (Temple, Goshala, Books), any date range.
 * All of it is worked out in the browser from the numbered vouchers (lib/accounts.ts), so what is
 * on screen, in the Excel file and in the PDF is one calculation, not three.
 */
export default function Accounts() {
  const { ws, canManage, categories, banks, people } = useWs();
  const [tab, setTab] = useState<"reports" | "setup">("reports");
  const [scope, setScope] = useState<Scope>("all");
  const [reportId, setReportId] = useState("trial-balance");
  const [period, setPeriod] = useState<Period>("month");
  const [anchor, setAnchor] = useState(today());
  const [custom, setCustom] = useState({ from: monthRange(today()).from, to: today() });
  const [data, setData] = useState<BooksData | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(""); const [exportErr, setExportErr] = useState("");

  const load = useCallback(() => {
    if (!canManage) return;
    setLoadErr("");
    loadBooksData(ws.id).then(setData).catch((e: Error) => { setData(null); setLoadErr(e.message); });
  }, [ws.id, canManage]);
  useEffect(() => { setData(null); load(); }, [load]);

  const range = useMemo(() => {
    if (period !== "custom") return rangeFor(period, anchor);
    const [from, to] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
    return { from, to, label: rangeText(from, to) };
  }, [period, anchor, custom]);

  const names = useMemo(() => ({
    cat: (id: string | null) => categories.find((c) => c.id === id)?.name ?? "",
    person: (id: string | null) => people.find((p) => p.id === id)?.name ?? "",
  }), [categories, people]);

  const books = useMemo(() => data && buildBooks(data.entries, { categories, banks, opening: data.opening, vouchersFrom: ws.vouchers_from }, names), [data, categories, banks, ws.vouchers_from, names]);
  const report = reportById(reportId);
  const ctx = useMemo(() => books && { b: books, scope, from: range.from, to: range.to, txns: data?.txns ?? [] }, [books, scope, range, data]);
  const sheet = useMemo(() => (ctx ? report.build(ctx) : null), [ctx, report]);
  const hasVouchers = !!data?.entries.some((e) => e.voucher_no);

  const step = (dir: -1 | 1) => setAnchor(dir < 0 ? addDays(range.from, -1) : addDays(range.to, 1));
  const scopeName = SCOPES.find((s) => s.id === scope)!.label;
  const base = `${slug(ws.name) || "books"}-${scope}-${range.from}_${range.to}`;

  async function run(label: string, job: () => Promise<void>) {
    setBusy(label); setExportErr("");
    try { await job(); } catch (e) { setExportErr((e as Error).message || "Could not create the file."); } finally { setBusy(""); }
  }
  const excelOne = () => run("excel", async () => { const m = await import("@/lib/exportSheets"); m.downloadExcel([sheet!], ws.name, `${report.id}-${base}.xlsx`); });
  const pdfOne = () => run("pdf", async () => { const m = await import("@/lib/exportSheets"); await m.downloadPdf([sheet!], ws.name, `${sheet!.title} · ${range.label}`, `${report.id}-${base}.pdf`); });
  const pack = () => run("pack", async () => {
    const sheets = auditorPack(ctx!);
    const m = await import("@/lib/exportSheets");
    m.downloadExcel(sheets, ws.name, `auditor-pack-${base}.xlsx`);
    await m.downloadPdf(sheets, ws.name, `Auditor pack · ${scopeName} · ${range.label}`, `auditor-pack-${base}.pdf`);
  });

  if (!canManage) return <p className="rounded-lg border border-slate-200 bg-surface p-6 text-slate-600 shadow-card">Only owners and admins can open the books.</p>;

  const tabBtn = (id: typeof tab, label: string) => (
    <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === id ? "bg-indigo-600 text-white" : "border border-slate-300 bg-surface text-slate-600 hover:border-indigo-400"}`}>{label}</button>
  );
  const groups = ["Books of account", "Statements", "Lists"] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[24px] font-bold text-slate-800">Accounts</h1>
          <p className="text-sm text-slate-500">Journal → Ledger → Trial balance, accrual basis, financial year April–March{ws.vouchers_from ? ` · books start ${dmy(ws.vouchers_from)}` : ""}.</p>
        </div>
        <div className="flex gap-2">{tabBtn("reports", "Reports")}{tabBtn("setup", "Setup")}</div>
      </div>

      {tab === "setup" && <AccountsSetup opening={data?.opening ?? NO_OPENING} onChanged={load} />}

      {tab === "reports" && (
        <>
          {/* The last column holds two dates or a quarter's name, so it gets more room than the three selects. */}
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-surface p-3 shadow-card sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.6fr] print:hidden">
            <label className="text-xs text-slate-500">Book
              <select aria-label="Book" className={input} value={scope} onChange={(e) => setScope(e.target.value as Scope)}>{SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </label>
            <label className="text-xs text-slate-500 lg:col-span-1">Report
              <select aria-label="Report" className={input} value={reportId} onChange={(e) => setReportId(e.target.value)}>
                {groups.map((g) => <optgroup key={g} label={g}>{REPORTS.filter((r) => r.group === g).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</optgroup>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">Period
              <select aria-label="Period" className={input} value={period} onChange={(e) => { const p = e.target.value as Period; if (p === "custom") setCustom({ from: range.from, to: range.to }); setPeriod(p); }}>{PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            </label>
            <div className="text-xs text-slate-500">{period === "custom" ? "Dates" : "Showing"}
              {period === "custom" ? (
                <div className="flex gap-1"><input type="date" className={`${input} min-w-0`} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" /><input type="date" className={`${input} min-w-0`} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" /></div>
              ) : (
                <div className="flex items-center gap-1">
                  <button className={`${btnGhost} !px-2.5`} onClick={() => step(-1)} aria-label="Previous period">‹</button>
                  <span className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-center text-sm font-medium text-slate-700" title={range.label}>{range.label}</span>
                  <button className={`${btnGhost} !px-2.5`} onClick={() => step(1)} aria-label="Next period">›</button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <p className="text-xs text-slate-500">{report.asOn ? `This report is as on ${dmy(range.to)}.` : `From ${dmy(range.from)} to ${dmy(range.to)}.`}</p>
            <div className="flex flex-wrap gap-2">
              <button className={btnGhost} disabled={!sheet || !!busy} onClick={excelOne}>{busy === "excel" ? "Preparing…" : "Excel"}</button>
              <button className={btnGhost} disabled={!sheet || !!busy} onClick={pdfOne}>{busy === "pdf" ? "Preparing…" : "PDF"}</button>
              <button className={btnPrimary} disabled={!ctx || !!busy} onClick={pack} title={`Every report, for ${scopeName}, ${range.label}: one Excel workbook and one PDF`}>{busy === "pack" ? "Preparing…" : "Auditor pack (Excel + PDF)"}</button>
            </div>
          </div>
          {exportErr && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{exportErr}</p>}
          {loadErr && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Could not load the books: {loadErr}. If this says a table or column does not exist, run <code>supabase/migrations/20260101000006_books.sql</code> in the Supabase SQL Editor.
            </p>
          )}
          {!data && !loadErr && <p className="p-6 text-center text-slate-400">Loading the books…</p>}
          {data && !hasVouchers && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              There are no vouchers yet{ws.vouchers_from ? ` — entries dated ${dmy(ws.vouchers_from)} or later become vouchers` : ""}. The reports will fill in as entries are made.
            </p>
          )}
          {sheet && <SheetTable sheet={sheet} />}
        </>
      )}
    </div>
  );
}
