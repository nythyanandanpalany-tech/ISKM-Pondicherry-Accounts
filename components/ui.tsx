"use client";
import { useEffect, useId, useRef, useState } from "react";
import { db } from "@/lib/db";

export const input =
  "w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-800 transition focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
export const btn =
  "inline-flex min-h-11 items-center justify-center gap-1 rounded-md px-4 py-2 text-sm font-semibold transition disabled:opacity-50";
export const btnPrimary = `${btn} bg-indigo-600 text-white shadow-card hover:bg-indigo-700`;
export const btnGhost = `${btn} border border-slate-300 bg-surface text-slate-700 hover:bg-slate-50`;
export const btnDanger = `${btn} border border-red-200 bg-surface text-red-600 hover:bg-red-50`;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // don't scroll the page behind the dialog
    const focusable = () => Array.from(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
    // Move focus in, unless a child already claimed it with autoFocus.
    if (!box.current?.contains(document.activeElement)) (focusable()[0] ?? box.current)?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const f = focusable(); if (!f.length) return;
      // Keep Tab inside the dialog; otherwise it walks off into the page underneath, which a
      // screen-reader or keyboard user cannot see is still there.
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.(); // hand focus back to whatever opened us
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-800/40 p-3 sm:p-8" onClick={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`w-full ${wide ? "max-w-4xl" : "max-w-xl"} rounded-lg border border-slate-200 border-t-2 border-t-gold bg-surface p-5 shadow-hover-card outline-none`}
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-lg font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Stands in for window.confirm on anything that cannot be undone. The native dialog cannot say
 * what will actually happen, cannot be styled or translated, and some browsers suppress it
 * outright — which would silently turn "are you sure?" into "yes".
 */
export function Confirm({ title, children, confirmLabel = "Confirm", danger, onClose, onConfirm }: {
  title: string; children: React.ReactNode; confirmLabel?: string; danger?: boolean; onClose: () => void; onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try { await onConfirm(); } catch (e) { setErr((e as Error)?.message ?? "Could not complete that."); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-600">
        {children}
        {err && <p className="text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={danger ? btnDanger : btnPrimary} onClick={go} disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Stands in for window.prompt. `mustEqual` holds the button shut until an exact phrase is typed,
 * the way a workspace's own name guards deleting its books.
 */
export function PromptDialog({ title, children, label, placeholder, password, mustEqual, confirmLabel = "Continue", danger, onClose, onSubmit }: {
  title: string; children?: React.ReactNode; label: string; placeholder?: string; password?: boolean;
  mustEqual?: string; confirmLabel?: string; danger?: boolean; onClose: () => void; onSubmit: (value: string) => void | Promise<void>;
}) {
  const [v, setV] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const ready = !!v.trim() && (!mustEqual || v.trim() === mustEqual);
  async function go(e: React.FormEvent) {
    e.preventDefault(); if (!ready) return;
    setBusy(true); setErr("");
    try { await onSubmit(v.trim()); } catch (ex) { setErr((ex as Error)?.message ?? "Could not complete that."); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={go} className="space-y-3 text-sm">
        {children && <div className="text-slate-600">{children}</div>}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
          <input className={input} type={password ? "password" : "text"} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
        </label>
        {err && <p className="text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={danger ? btnDanger : btnPrimary} disabled={busy || !ready}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * A document-present / missing / not-needed marker. On its own the glyph is read aloud as
 * "white heavy check mark", which says nothing about the bill, so the meaning is given as text too.
 */
export function Mark({ state, kind }: { state: "yes" | "missing" | "none"; kind: string }) {
  const [glyph, text] = state === "yes" ? ["✅", `${kind}: attached`]
    : state === "missing" ? ["⚠️", `${kind}: missing`] : ["—", `${kind}: not needed`];
  return <span title={text}><span aria-hidden="true">{glyph}</span><span className="sr-only">{text}</span></span>;
}

/** Props that make a clickable table row work from the keyboard as well as the mouse. */
export const rowActivate = (fn: () => void, label: string) => ({
  tabIndex: 0,
  "aria-label": label,
  onClick: fn,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
  },
});
export const rowClickable = "cursor-pointer border-t border-slate-200 hover:bg-slate-50 focus:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

const TTL = 3600;                              // how long Storage signs each link for
const REUSE_FOR = (TTL - 300) * 1000;          // stop reusing ours five minutes before that
const urlCache = new Map<string, { url: string; at: number }>();
/** A link to a private file, cached only while it is still valid — these do expire. */
const cached = (path: string) => {
  const hit = urlCache.get(path);
  return hit && Date.now() - hit.at < REUSE_FOR ? hit.url : null;
};
export function useSignedUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(path ? cached(path) : null);
  useEffect(() => {
    if (!path) return;
    const hit = cached(path);
    if (hit) { setUrl(hit); return; }
    let alive = true;
    db.storage.from("receipts").createSignedUrl(path, TTL).then(({ data }) => {
      if (alive && data) { urlCache.set(path, { url: data.signedUrl, at: Date.now() }); setUrl(data.signedUrl); }
    });
    return () => { alive = false; };
  }, [path]);
  return path ? url : null;
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
