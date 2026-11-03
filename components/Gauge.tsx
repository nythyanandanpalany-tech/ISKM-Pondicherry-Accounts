export default function Gauge({ label, spent, limit, money }: { label: string; spent: number; limit: number; money: (n: number) => string }) {
  const pct = Math.min(100, (spent / limit) * 100); const over = spent > limit;
  return (
    <div className="text-sm"><div className="flex justify-between"><span>{label}</span><span className={over ? "font-semibold text-red-600" : ""}>{money(spent)} / {money(limit)}</span></div>
      <div className="mt-1 h-2 rounded bg-slate-100"><div className={`h-2 rounded ${over ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} /></div></div>
  );
}

