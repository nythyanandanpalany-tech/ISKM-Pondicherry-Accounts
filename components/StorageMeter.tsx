"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const FREE_BYTES = 1024 * 1024 * 1024; // Supabase free plan: 1 GB of files
const mb = (b: number) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0);

export function useStorageUsage(enabled: boolean) {
  const [used, setUsed] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    supabase.rpc("storage_usage_total").then(({ data, error }) => { if (!error && data != null) setUsed(Number(data)); });
  }, [enabled]);
  return used;
}

export default function StorageMeter({ used, compact }: { used: number | null; compact?: boolean }) {
  if (used == null) return null;
  const pct = Math.min(100, (used / FREE_BYTES) * 100);
  const tone = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="text-sm">
      <div className="flex justify-between"><span>Photo storage (free plan)</span><span className={pct >= 90 ? "font-semibold text-red-600" : ""}>{mb(used)} MB / 1024 MB</span></div>
      <div className="mt-1 h-2 rounded bg-slate-100"><div className={`h-2 rounded ${tone}`} style={{ width: `${pct}%` }} /></div>
      {!compact && <p className="mt-1 text-xs text-slate-500">{pct >= 75 ? "Getting full. In Settings → Free up photo space, back up old photos to a ZIP and remove them from the server, or upgrade later." : "Plenty of room. Photos are compressed to about 100 KB each."}</p>}
    </div>
  );
}
