"use client";
import { createPortal } from "react-dom";
import { dmy, rupeesInWords } from "@/lib/format";
import type { Entry } from "@/lib/types";
import { useWs } from "./WorkspaceProvider";
import { Modal, btnGhost, btnPrimary } from "./ui";
import { brand } from "@/lib/brand";
import { LotusMark } from "./Brand";

function Sheet({ e }: { e: Entry }) {
  const { ws, catName, itemName, personName } = useWs();
  const row = (k: string, v: string) => <div style={{ display: "flex", borderBottom: "1px solid #999", padding: "6px 0" }}><div style={{ width: 150, color: "#444" }}>{k}</div><div style={{ flex: 1, fontWeight: 600 }}>{v || "—"}</div></div>;
  return (
    <div className="voucher-page" style={{ border: "2px solid #111", padding: 24, margin: "0 auto 24px", maxWidth: 720, background: "#fff", color: "#111", fontSize: 14 }}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: "#b8912a" }} lang="sa">॥ हरे कृष्ण ॥</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 6 }}>
          <LotusMark size={34} print />
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{brand.legalName}</div>
            {brand.address && <div style={{ fontSize: 11, color: "#555" }}>{brand.address}</div>}
          </div>
        </div>
        <div style={{ height: 1, background: "#b8912a", opacity: 0.6, margin: "10px 0 8px" }} />
        <div style={{ fontSize: 13, color: "#444" }}>{ws.name}</div>
        <div style={{ letterSpacing: 3, fontWeight: 700, marginTop: 2 }}>PAYMENT VOUCHER</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span>Voucher No: <b>V-{e.id.slice(0, 8).toUpperCase()}</b></span><span>Date: <b>{dmy(e.entry_date)}</b></span></div>
      {row("Paid to", personName(e.person_id))}{row("Towards", [catName(e.category_id), itemName(e.item_id), e.note].filter(Boolean).join(" · "))}
      {row("Mode of payment", e.payment_mode + (e.reference_no ? ` (Ref ${e.reference_no})` : ""))}
      {row("Amount", `${ws.currency} ${e.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`)}{row("In words", rupeesInWords(e.amount))}
      <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>No bill/receipt was available for this payment; this voucher records it.</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 56, fontSize: 12 }}>
        {["Prepared by", "Approved by", "Receiver’s signature"].map((x) => <div key={x} style={{ width: "30%", borderTop: "1px solid #111", paddingTop: 4, textAlign: "center" }}>{x}</div>)}</div>
      <div style={{ marginTop: 18, textAlign: "center", fontSize: 10, color: "#8a7a5c", letterSpacing: 1 }}>
        {brand.legalName} · {brand.app} · all glories to Śrīla Prabhupāda
      </div>
    </div>
  );
}

export default function Vouchers({ entries, onClose }: { entries: Entry[]; onClose: () => void }) {
  function print() {
    document.body.classList.add("printing-voucher");
    const done = () => { document.body.classList.remove("printing-voucher"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done); window.print();
  }
  return (
    <>
      <Modal title={`Vouchers · ${entries.length}`} onClose={onClose} wide>
        <p className="mb-3 text-sm text-slate-500">Payment vouchers for expenses that have no bill photo. Print them (or “Save as PDF”) and get them signed.</p>
        <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-slate-100 p-3">{entries.map((e) => <Sheet key={e.id} e={e} />)}</div>
        <div className="mt-4 flex justify-end gap-2"><button className={btnGhost} onClick={onClose}>Close</button><button className={btnPrimary} onClick={print}>Print / Save PDF</button></div>
      </Modal>
      {typeof document !== "undefined" && createPortal(<div className="voucher-root">{entries.map((e) => <Sheet key={e.id} e={e} />)}</div>, document.body)}
    </>
  );
}
