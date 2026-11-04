"use client";
import { useEffect, useState } from "react";
import { Modal, btnGhost, btnPrimary } from "./ui";
import { brand } from "@/lib/brand";

const STEPS: [string, string][] = [
  [`${brand.greeting} 🙏`, `${brand.app} keeps the temple’s books — bhoga, puja, maintenance, donations — in one workspace, with proof behind every rupee. This one-minute tour shows where everything is.`],
  ["Record a seva expense", "Use + Add entry on the Dashboard or Ledger. Attach the bill photo and the payment screenshot, so every payment made on the temple’s behalf can be shown to anyone who asks."],
  ["Ledger, Analytics & daily report", "Search and filter the Ledger, export to Excel or PDF, read the month in Analytics, and share the daily seva report with the temple group."],
  ["Claims for sevaks", "When a devotee pays from their own pocket, tick “Paid from own pocket” on the expense. It appears under Claims for an admin to approve and settle."],
  ["Bank statement & Reconcile", "Admins import the bank CSV and match each bank row to an entry, with the bill and the payment screenshot side by side — the temple’s books and the bank agree at the end of every month."],
  ["Store & Chats", "Track stock of rice, ghee, flowers and other provisions in Store, and speak with the other sevaks in Chats. Open ☰ for Settings and Help."],
];
export function startTour() { window.dispatchEvent(new Event("ef-tour")); }

export default function Tour() {
  const [open, setOpen] = useState(false); const [i, setI] = useState(0);
  useEffect(() => {
    let seen = false; try { seen = localStorage.getItem("ef_tour") === "1"; } catch { /* ignore */ }
    if (!seen) setOpen(true);
    const h = () => { setI(0); setOpen(true); }; window.addEventListener("ef-tour", h); return () => window.removeEventListener("ef-tour", h);
  }, []);
  const close = () => { setOpen(false); try { localStorage.setItem("ef_tour", "1"); } catch { /* ignore */ } };
  if (!open) return null;
  return (
    <Modal title={STEPS[i][0]} onClose={close}>
      <p className="text-sm leading-relaxed text-slate-600">{STEPS[i][1]}</p>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-xs text-slate-400">{i + 1} / {STEPS.length}</span>
        <div className="flex gap-2"><button className={btnGhost} onClick={close}>Skip</button>
          {i > 0 && <button className={btnGhost} onClick={() => setI(i - 1)}>Back</button>}
          <button className={btnPrimary} onClick={() => (i + 1 < STEPS.length ? setI(i + 1) : close())}>{i + 1 < STEPS.length ? "Next" : "Done"}</button></div>
      </div>
    </Modal>
  );
}
