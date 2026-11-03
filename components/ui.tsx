"use client";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";

export const input =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
export const btn =
  "inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50";
export const btnPrimary = `${btn} bg-indigo-600 text-white hover:bg-indigo-700`;
export const btnGhost = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
export const btnDanger = `${btn} border border-red-200 bg-white text-red-600 hover:bg-red-50`;

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-8" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-4xl" : "max-w-xl"} rounded-2xl bg-white p-5 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const urlCache = new Map<string, string>();
export function useSignedUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(path ? urlCache.get(path) ?? null : null);
  useEffect(() => {
    if (!path) return;
    if (urlCache.has(path)) return;
    let alive = true;
    db.storage.from("receipts").createSignedUrl(path, 3600).then(({ data }) => {
      if (alive && data) { urlCache.set(path, data.signedUrl); setUrl(data.signedUrl); }
    });
    return () => { alive = false; };
  }, [path]);
  return path ? urlCache.get(path) ?? url : null;
}

/** Shows an uploaded receipt image (or a PDF link). Click to open full size. */
export function Receipt({ path, label, size = "md" }: { path: string | null; label: string; size?: "sm" | "md" | "lg" }) {
  const url = useSignedUrl(path);
  const h = size === "sm" ? "h-16 w-16" : size === "md" ? "h-40 w-full" : "h-80 w-full";
  const isPdf = path?.toLowerCase().endsWith(".pdf");
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {!path ? (
        <div className={`${h} flex items-center justify-center rounded-lg border border-dashed border-amber-300 bg-amber-50 text-xs text-amber-700`}>Missing</div>
      ) : !url ? (
        <div className={`${h} animate-pulse rounded-lg bg-slate-100`} />
      ) : isPdf ? (
        <a href={url} target="_blank" className={`${h} flex items-center justify-center rounded-lg border bg-slate-50 text-xs text-indigo-600 underline`}>Open PDF</a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} className={`${h} rounded-lg border bg-slate-50 object-contain`} />
        </a>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const c = status === "approved" ? "bg-emerald-100 text-emerald-700" : status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${c}`}>{status}</span>;
}
