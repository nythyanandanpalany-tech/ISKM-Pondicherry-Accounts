"use client";
import type { Cell, Sheet } from "@/lib/sheets";

const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (c: Cell) => (c == null ? "" : typeof c === "number" ? fmt(c) : c);

/** A report sheet on screen: the same rows the Excel file and the PDF are made from. */
export default function SheetTable({ sheet }: { sheet: Sheet }) {
  const total = sheet.columns.reduce((t, c) => t + (c.weight ?? 1), 0);
  return (
    <section className="rounded-lg border border-slate-200 bg-surface shadow-card" aria-label={sheet.title}>
      <header className="border-b border-slate-200 p-4">
        <h2 className="font-display text-lg font-bold text-slate-800">{sheet.title}</h2>
        <p className="text-sm text-slate-500">{sheet.subtitle} <span className="text-slate-400">· amounts in ₹</span></p>
      </header>
      <div className="overflow-x-auto">
        {/* Wide reports scroll sideways on a phone instead of squeezing the account names into a sliver. */}
        <table className="w-full text-sm" style={{ minWidth: Math.max(640, sheet.columns.length * 120) }}>
          <colgroup>{sheet.columns.map((c, i) => <col key={i} style={{ width: `${((c.weight ?? 1) / total) * 100}%` }} />)}</colgroup>
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>{sheet.columns.map((c, i) => <th key={i} className={`px-3 py-2 font-semibold ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {sheet.rows.map((r, ri) =>
              r.kind === "head" ? (
                <tr key={ri} className="bg-hover"><td colSpan={sheet.columns.length} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-gold-ink">{r.cells[0]}</td></tr>
              ) : (
                <tr key={ri} className={`border-t border-slate-100 ${r.kind === "total" ? "border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800" : r.kind === "sub" ? "italic text-slate-500" : "text-slate-700"}`}>
                  {r.cells.map((c, ci) => (
                    <td key={ci} className={`px-3 py-1.5 align-top ${sheet.columns[ci].align === "right" ? "whitespace-nowrap text-right tabular-nums" : ""} ${ci === 1 && sheet.columns[ci].label === "Voucher" ? "whitespace-nowrap font-mono text-xs" : ""}`}>{show(c)}</td>
                  ))}
                </tr>
              ),
            )}
            {!sheet.rows.some((r) => r.kind !== "total" && r.kind !== "head") && (
              <tr><td colSpan={sheet.columns.length} className="px-3 py-6 text-center text-slate-400">Nothing to show for this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {sheet.notes.length > 0 && (
        <ul className="space-y-0.5 border-t border-slate-200 p-3 text-xs text-slate-500">{sheet.notes.map((n, i) => <li key={i} className={n.includes("DOES NOT") ? "font-semibold text-red-700" : ""}>{n}</li>)}</ul>
      )}
    </section>
  );
}
