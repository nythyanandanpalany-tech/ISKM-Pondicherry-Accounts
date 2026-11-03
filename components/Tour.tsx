"use client";
import { useEffect, useState } from "react";
import { Modal, btnGhost, btnPrimary } from "./ui";

const STEPS = [
  ["Welcome 🙏", "ExpenseFlow keeps your temple or seva accounts in one workspace. This 1-minute tour shows where everything is."],
  ["Add entries", "Use + Add entry on the Dashboard or Ledger. Attach the bill photo and the payment screenshot so every payment has proof."],
  ["Ledger, Analytics & Report", "Search and filter the Ledger, export to Excel/PDF, see charts in Analytics, and share the daily Report."],
  ["Claims", "Tick “Paid from own pocket” on an expense to start a reimbursement. Admins approve and settle it under Claims."],
  ["Bank statement & Reconcile", "Admins import the bank CSV and match each bank row to an entry, comparing the bill and payment screenshot side by side."],
  ["Store & Chats", "Track stock of rice, oil and more in Store, and talk to your team in Chats. Open ☰ for Settings and Help."],
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
      <p className="text-sm text-slate-600">{STEPS[i][1]}</p>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-xs text-slate-400">{i + 1} / {STEPS.length}</span>
        <div className="flex gap-2"><button className={btnGhost} onClick={close}>Skip</button>
          {i > 0 && <button className={btnGhost} onClick={() => setI(i - 1)}>Back</button>}
          <button className={btnPrimary} onClick={() => (i + 1 < STEPS.length ? setI(i + 1) : close())}>{i + 1 < STEPS.length ? "Next" : "Done"}</button></div>
      </div>
    </Modal>
  );
}
