"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dmy, today } from "@/lib/format";
import type { StockMove, Store, StoreItem } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { useWs } from "@/components/WorkspaceProvider";
import { Modal, btnDanger, btnGhost, btnPrimary, input } from "@/components/ui";

export default function StorePage() {
  const { profile } = useAuth();
  const { ws, canManage, canWrite } = useWs();
  const [stores, setStores] = useState<Store[]>([]); const [items, setItems] = useState<StoreItem[]>([]);
  const [stock, setStock] = useState<Map<string, number>>(new Map());
  const [sel, setSel] = useState<string | null>(null);
  const [move, setMove] = useState<{ item: StoreItem; dir: "in" | "out" } | null>(null);
  const [hist, setHist] = useState<StoreItem | null>(null);
  const [newStore, setNewStore] = useState(""); const [ni, setNi] = useState({ name: "", unit: "kg", min_qty: "0" });

  const load = useCallback(async () => {
    const [s, i, q] = await Promise.all([
      supabase.from("stores").select("*").eq("workspace_id", ws.id).order("name"),
      supabase.from("store_items").select("*").eq("workspace_id", ws.id).order("name"),
      supabase.from("store_stock").select("*").eq("workspace_id", ws.id),
    ]);
    const list = (s.data as Store[]) ?? [];
    setStores(list); setItems((i.data as StoreItem[]) ?? []);
    setStock(new Map(((q.data as { store_item_id: string; qty: number }[]) ?? []).map((r) => [r.store_item_id, r.qty])));
    setSel((cur) => (list.find((x) => x.id === cur) ? cur : list[0]?.id ?? null));
  }, [ws.id]);
  useEffect(() => { load(); }, [load]);

  const current = stores.find((s) => s.id === sel);
  const list = useMemo(() => items.filter((i) => i.store_id === sel), [items, sel]);
  const err = (e: { message: string } | null) => e && alert(e.message);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-bold">Store</h1>
        {canManage && <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const { error } = await supabase.from("stores").insert({ workspace_id: ws.id, name: newStore.trim() }); err(error); setNewStore(""); load(); }}>
          <input className={`${input} !w-48`} placeholder="New store name" value={newStore} onChange={(e) => setNewStore(e.target.value)} required /><button className={btnPrimary}>Add store</button></form>}</div>
      <p className="text-sm text-slate-500">Track stock of items like rice (kg), oil (litres) or flour (bags). Record stock in when goods arrive and stock out when used.</p>
      {!stores.length && <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-slate-400">No stores yet.{canManage ? " Add one above, e.g. “Annadanam Store”." : " Ask an admin to create one."}</div>}
      {stores.length > 0 && (<>
        <div className="flex flex-wrap items-center gap-2">{stores.map((s) => <button key={s.id} onClick={() => setSel(s.id)} className={`rounded-full px-3 py-1 text-sm ${sel === s.id ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}>{s.name}</button>)}
          {canManage && current && <button className="text-xs text-red-600" onClick={async () => { if (confirm(`Delete store “${current.name}” with all items and history?`)) { const { error } = await supabase.from("stores").delete().eq("id", current.id); err(error); load(); } }}>delete store</button>}</div>
        {canManage && current && (
          <form className="flex flex-wrap gap-2 rounded-xl border bg-white p-3" onSubmit={async (e) => { e.preventDefault(); const { error } = await supabase.from("store_items").insert({ workspace_id: ws.id, store_id: current.id, name: ni.name.trim(), unit: ni.unit.trim() || "pcs", min_qty: parseInt(ni.min_qty) || 0 }); err(error); setNi({ ...ni, name: "" }); load(); }}>
            <input className={`${input} !w-56`} placeholder="New item (e.g. Rice)" value={ni.name} onChange={(e) => setNi({ ...ni, name: e.target.value })} required />
            <input className={`${input} !w-28`} placeholder="Unit" list="units" value={ni.unit} onChange={(e) => setNi({ ...ni, unit: e.target.value })} />
            <datalist id="units">{["kg", "litres", "bags", "packets", "pcs", "boxes"].map((u) => <option key={u} value={u} />)}</datalist>
            <input className={`${input} !w-32`} type="number" min="0" placeholder="Low-stock level" value={ni.min_qty} onChange={(e) => setNi({ ...ni, min_qty: e.target.value })} />
            <button className={btnGhost}>Add item</button></form>)}
        <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Item</th><th className="text-right">In stock</th><th className="px-3">Status</th><th /></tr></thead>
          <tbody>{list.map((i) => { const q = stock.get(i.id) ?? 0; const low = q <= i.min_qty; return (
            <tr key={i.id} className="border-t"><td className="p-3 font-medium">{i.name}</td>
              <td className="text-right text-base font-bold">{q} <span className="text-xs font-normal text-slate-500">{i.unit}</span></td>
              <td className="px-3">{q === 0 ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Out of stock</span> : low ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Low (≤ {i.min_qty})</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">OK</span>}</td>
              <td className="space-x-1 p-2 text-right whitespace-nowrap">
                {canWrite && <button className={btnPrimary} onClick={() => setMove({ item: i, dir: "in" })}>+ In</button>}
                {canWrite && <button className={btnGhost} onClick={() => setMove({ item: i, dir: "out" })} disabled={q === 0}>− Out</button>}
                <button className={btnGhost} onClick={() => setHist(i)}>History</button>
                {canManage && <button className={btnDanger} onClick={async () => { if (confirm(`Delete ${i.name} and its history?`)) { const { error } = await supabase.from("store_items").delete().eq("id", i.id); err(error); load(); } }}>×</button>}</td></tr>); })}
            {!list.length && <tr><td colSpan={4} className="p-6 text-center text-slate-400">No items in this store yet.</td></tr>}</tbody></table></div></>)}
      {move && <MoveModal item={move.item} dir={move.dir} max={stock.get(move.item.id) ?? 0} userId={profile.id} wsId={ws.id} onClose={() => setMove(null)} onDone={() => { setMove(null); load(); }} />}
      {hist && <HistoryModal item={hist} canManage={canManage} onClose={() => setHist(null)} onChanged={load} />}
    </div>
  );
}

function MoveModal({ item, dir, max, userId, wsId, onClose, onDone }: { item: StoreItem; dir: "in" | "out"; max: number; userId: string; wsId: string; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(""); const [date, setDate] = useState(today()); const [note, setNote] = useState(""); const [err, setErr] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const q = parseInt(qty); if (!q || q < 1) return setErr("Enter a whole number of at least 1.");
    if (dir === "out" && q > max) return setErr(`Only ${max} ${item.unit} in stock.`);
    const { error } = await supabase.from("stock_moves").insert({ workspace_id: wsId, store_item_id: item.id, direction: dir, qty: q, move_date: date, note: note.trim() || null, created_by: userId });
    if (error) return setErr(error.message); onDone();
  }
  return (
    <Modal title={`${dir === "in" ? "Stock in" : "Stock out"} · ${item.name}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">Quantity ({item.unit}) — whole numbers<input className={input} type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus required /></label>
          <label className="text-xs">Date<input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label></div>
        <label className="block text-xs">Note (supplier, purpose…)<input className={input} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {dir === "out" && <p className="text-xs text-slate-500">Available: {max} {item.unit}</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary}>Save</button></div>
      </form>
    </Modal>
  );
}

function HistoryModal({ item, canManage, onClose, onChanged }: { item: StoreItem; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<StockMove[]>([]);
  const load = useCallback(async () => { const { data } = await supabase.from("stock_moves").select("*").eq("store_item_id", item.id).order("move_date", { ascending: false }).order("created_at", { ascending: false }); setRows((data as StockMove[]) ?? []); }, [item.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <Modal title={`History · ${item.name}`} onClose={onClose}>
      <div className="max-h-[60vh] overflow-y-auto">{rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between border-b py-2 text-sm">
          <div><span className={`font-semibold ${r.direction === "in" ? "text-emerald-600" : "text-red-600"}`}>{r.direction === "in" ? "+" : "−"}{r.qty} {item.unit}</span><span className="ml-2 text-slate-500">{dmy(r.move_date)} {r.note && `· ${r.note}`}</span></div>
          {canManage && <button className="text-xs text-red-600" onClick={async () => { if (!confirm("Delete this record?")) return; const { error } = await supabase.from("stock_moves").delete().eq("id", r.id); if (error) return alert(error.message); load(); onChanged(); }}>delete</button>}
        </div>))}{!rows.length && <div className="p-4 text-center text-sm text-slate-400">No movements yet.</div>}</div>
    </Modal>
  );
}
