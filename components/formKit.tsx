"use client";
/* The small pieces the entry form and the journal form share. */

export const lbl = "mb-1 block text-xs font-medium text-slate-600";
/* Section heading, set like the sidebar's "Seva" / "More" dividers so the dialog
   reads as part of the same shell rather than a form pasted into it. */
export const sec = "text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400";
export const hint = "text-xs text-slate-500";

/* A tappable choice. The radio stays in the DOM but visually hidden, so arrow keys,
   screen readers and the focus ring all behave the way a native radio group does —
   a row of <button>s would have given up all three. */
const tile = "relative flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition focus-within:ring-2 focus-within:ring-indigo-500";
const tileOn = "border-indigo-600 bg-indigo-600 text-white shadow-card";
const tileOff = "border-slate-300 bg-surface text-slate-600 hover:border-indigo-400 hover:bg-hover";

export function Choice({ name, checked, onSelect, children }: {
  name: string; checked: boolean; onSelect: () => void; children: React.ReactNode;
}) {
  return (
    <label className={`${tile} ${checked ? tileOn : tileOff}`}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

/** A voucher number set the way an auditor reads it: monospaced, never wrapped. */
export function VoucherNo({ no, className = "" }: { no: string | null; className?: string }) {
  if (!no) return null;
  return <span className={`whitespace-nowrap font-mono text-[11px] text-slate-500 ${className}`}>{no}</span>;
}

/** Marks an expense with no bill — a self-voucher. */
export function NoBillTag() {
  return <span className="ml-1.5 inline-block rounded-full bg-amber-100 px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-800">No bill</span>;
}
