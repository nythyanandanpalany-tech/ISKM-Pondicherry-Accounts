"use client";
import { useMemo, useState } from "react";
import type { Entry } from "@/lib/types";

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
};

const BAR_H = 160;

export default function CashflowChart({ rows, money }: { rows: Entry[]; money: (n: number) => string }) {
  const [span, setSpan] = useState<6 | 12>(6);
  const [hover, setHover] = useState<string | null>(null);

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: span }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (span - 1 - i), 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
  }, [span]);

  const data = useMemo(() => months.map((m) => {
    const inMonth = rows.filter((r) => r.entry_date.startsWith(m));
    return {
      m,
      income: inMonth.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0),
      expense: inMonth.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0),
    };
  }), [months, rows]);

  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const empty = data.every((d) => d.income === 0 && d.expense === 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-surface p-6 shadow-card">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-lg font-semibold text-slate-800">Cashflow</div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-600" />Income</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-600" />Expenses</span>
          </span>
          <select value={span} onChange={(e) => setSpan(Number(e.target.value) as 6 | 12)}
            className="rounded-md border border-slate-300 bg-surface px-2 py-1 text-xs text-slate-600">
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
          </select>
        </div>
      </div>
      {empty ? (
        <div className="flex items-center justify-center text-sm text-slate-400" style={{ height: BAR_H }}>No entries yet in this range.</div>
      ) : (
        <div className="relative flex items-end gap-2 sm:gap-4" style={{ height: BAR_H + 24 }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: BAR_H }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="border-t border-slate-100" />)}
          </div>
          {data.map((d) => {
            const active = hover === d.m;
            return (
              <div key={d.m} className="relative flex flex-1 flex-col items-center justify-end gap-2 outline-none" style={{ height: BAR_H }}
                tabIndex={0} aria-label={`${monthLabel(d.m)}: income ${money(d.income)}, expenses ${money(d.expense)}`}
                onMouseEnter={() => setHover(d.m)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(d.m)} onBlur={() => setHover(null)}>
                {active && (
                  <div className="absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-md border border-slate-200 bg-surface px-2.5 py-1.5 text-xs shadow-hover-card">
                    <div className="mb-1 font-medium text-slate-500">{monthLabel(d.m)}</div>
                    <div className="flex items-center gap-1.5"><span className="h-1.5 w-3 shrink-0 rounded-full bg-emerald-600" /><b className="text-slate-800">{money(d.income)}</b><span className="text-slate-400">income</span></div>
                    <div className="flex items-center gap-1.5"><span className="h-1.5 w-3 shrink-0 rounded-full bg-indigo-600" /><b className="text-slate-800">{money(d.expense)}</b><span className="text-slate-400">expense</span></div>
                  </div>
                )}
                <div className="flex h-full items-end gap-1">
                  <div className={`w-2.5 rounded-t transition-colors sm:w-3 ${active ? "bg-emerald-600" : "bg-emerald-600/55"}`} style={{ height: `${Math.max(2, (d.income / max) * 100)}%` }} />
                  <div className={`w-2.5 rounded-t transition-colors sm:w-3 ${active ? "bg-indigo-600" : "bg-indigo-600/55"}`} style={{ height: `${Math.max(2, (d.expense / max) * 100)}%` }} />
                </div>
                <div className="text-[11px] text-slate-400">{monthLabel(d.m)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
