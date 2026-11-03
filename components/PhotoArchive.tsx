"use client";
import { useEffect, useState } from "react";
import JSZip from "jszip";
import { db } from "@/lib/db";
import type { Entry } from "@/lib/types";
import { useWs } from "./WorkspaceProvider";
import { btnDanger, btnGhost } from "./ui";

type Row = Pick<Entry, "id" | "entry_date" | "amount" | "bill_path" | "payment_proof_path">;

/** Free up photo space on the free plan: back up old bill photos to a ZIP, then remove them from the server. Entries are kept. */
export default function PhotoArchive({ onDone }: { onDone: () => void }) {
  const { ws } = useWs();
  const [months, setMonths] = useState(12);
  const [rows, setRows] = useState<Row[]>([]);
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(""); const [msg, setMsg] = useState("");
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
  const cut = cutoff.toISOString().slice(0, 10);

  useEffect(() => {
    setBackedUp(false);
    db.from("entries").select("id,entry_date,amount,bill_path,payment_proof_path").eq("workspace_id", ws.id).lt("entry_date", cut)
      .or("bill_path.not.is.null,payment_proof_path.not.is.null").limit(2000).then(({ data }) => setRows((data as Row[]) ?? []));
  }, [ws.id, cut]);
  const files = rows.flatMap((r) => [r.bill_path && { path: r.bill_path, r, kind: "bill" }, r.payment_proof_path && { path: r.payment_proof_path, r, kind: "payment" }].filter(Boolean) as { path: string; r: Row; kind: string }[]);

  async function backup() {
    setBusy("Preparing ZIP…"); setMsg("");
    try {
      const zip = new JSZip(); const index = ["entry_id,date,amount,kind,file"]; let n = 0;
      for (const f of files) {
        const { data } = await db.storage.from("receipts").download(f.path); if (!data) continue;
        const name = `${f.r.entry_date}_${f.kind}_${f.r.id.slice(0, 8)}.${f.path.split(".").pop()}`;
        zip.file(name, data); index.push(`${f.r.id},${f.r.entry_date},${f.r.amount},${f.kind},${name}`); n++;
        if (n % 10 === 0) setBusy(`Adding photos… ${n}/${files.length}`);
      }
      zip.file("index.csv", index.join("\n"));
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `photos-before-${cut}.zip`; a.click();
      setBackedUp(true); setMsg(`Backup saved: ${n} photos. Check the ZIP opened fine, then you can remove them from the server.`);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(""); }
  }
  async function remove() {
    if (!confirm(`Permanently remove ${files.length} photos from the server? Entries stay; only the photos go. You can't undo this.`)) return;
    setBusy("Removing…");
    const paths = files.map((f) => f.path);
    for (let i = 0; i < paths.length; i += 100) { const { error } = await db.storage.from("receipts").remove(paths.slice(i, i + 100)); if (error) { setBusy(""); return setMsg(error.message); } }
    const { error } = await db.from("entries").update({ bill_path: null, payment_proof_path: null, receipt_available: false }).in("id", rows.map((r) => r.id));
    setBusy(""); setMsg(error ? error.message : `Removed ${paths.length} photos.`); setRows([]); setBackedUp(false); onDone();
  }
  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium">Free up photo space</div>
      <p className="text-xs text-slate-500">On the free plan photos are limited to 1 GB. Back up old photos to a ZIP on your computer, then remove them from the server. Entries and amounts are never deleted.</p>
      <div className="flex flex-wrap items-center gap-2">
        Photos on entries older than
        <select className="rounded-lg border px-2 py-1" value={months} onChange={(e) => setMonths(parseInt(e.target.value))}>{[3, 6, 12, 18, 24].map((m) => <option key={m} value={m}>{m} months</option>)}</select>
        <b>{files.length} photos</b>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={btnGhost} disabled={!files.length || !!busy} onClick={backup}>1. Download ZIP backup</button>
        <button className={btnDanger} disabled={!backedUp || !!busy} onClick={remove}>2. Remove from server</button>
      </div>
      {(busy || msg) && <p className="text-xs text-indigo-700">{busy || msg}</p>}
    </div>
  );
}
