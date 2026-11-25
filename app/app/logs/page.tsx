"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { db } from "@/lib/db";
import { useWs } from "@/components/WorkspaceProvider";
import { btnGhost, input } from "@/components/ui";

type Log = {
  id: number; at: string; actor: string | null; actor_name: string | null; workspace_id: string | null; workspace_name: string | null;
  area: string; action: string; summary: string; details: Record<string, unknown> | null;
};
const AREAS = ["Entries", "Heads", "People", "Members & roles", "Users", "Sign-in", "Workspace", "Bank", "Books setup", "Weekly settlement", "Daily report", "Store"];
const PAGE = 100;
const card = "rounded-lg border border-slate-200 bg-surface shadow-card";
const show = (v: unknown) => v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

/**
 * Every action of every user, as the database recorded it (activity_log, written by triggers — the browser
 * cannot add, change or remove a line). Super admins see all workspaces, sign-ins and role changes;
 * owners and admins see their own workspace.
 */
export default function Logs() {
  const { ws, workspaces, members, canManage, superAdmin } = useWs();
  const [rows, setRows] = useState<Log[] | null>(null);
  const [more, setMore] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ scope: superAdmin ? "all" : ws.id, who: "", area: "", from: "", to: "", q: "" });
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (superAdmin) db.rpc("admin_list_users").then(({ data }) => setPeople(((data as { id: string; full_name: string | null; email: string }[]) ?? []).map((u) => ({ id: u.id, name: u.full_name || u.email }))));
    else setPeople(members.map((m) => ({ id: m.user_id, name: m.profiles?.full_name || m.profiles?.email || "Member" })));
  }, [superAdmin, members]);

  const load = useCallback(async (offset = 0) => {
    let q = db.from("activity_log").select("*").order("id", { ascending: false }).range(offset, offset + PAGE - 1);
    const scope = superAdmin ? f.scope : ws.id;
    if (scope !== "all") q = q.eq("workspace_id", scope);
    if (f.who) q = q.eq("actor", f.who);
    if (f.area) q = q.eq("area", f.area);
    // Dates are India days.
    if (f.from) q = q.gte("at", `${f.from}T00:00:00+05:30`);
    if (f.to) q = q.lte("at", `${f.to}T23:59:59.999+05:30`);
    if (f.q.trim()) q = q.ilike("summary", `%${f.q.trim().replace(/[%_]/g, "")}%`);
    const { data, error } = await q;
    if (error) { setErr(error.message); return; }
    setErr("");
    const got = (data as Log[]) ?? [];
    setRows((prev) => (offset ? [...(prev ?? []), ...got] : got)); setMore(got.length === PAGE);
  }, [f, ws.id, superAdmin]);
  useEffect(() => { if (canManage) load(0); }, [canManage, load]);

  if (!canManage) return <p className={`${card} p-6 text-slate-600`}>Only owners, admins and super admins can see the logs.</p>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-bold text-slate-800">Logs</h1>
        <p className="text-sm text-slate-500">Everything everyone has done{superAdmin ? ", in every workspace" : ` in “${ws.name}”`}, recorded by the database. Nobody can edit or delete a line.</p>
      </div>

      <section className={`${card} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6`} aria-label="Filters">
        {superAdmin && <label className="text-xs text-slate-500">Workspace
          <select className={input} aria-label="Workspace" value={f.scope} onChange={set("scope")}>
            <option value="all">All workspaces</option>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>}
        <label className="text-xs text-slate-500">Who
          <select className={input} aria-label="Who" value={f.who} onChange={set("who")}>
            <option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label className="text-xs text-slate-500">Area
          <select className={input} aria-label="Area" value={f.area} onChange={set("area")}>
            <option value="">All areas</option>{AREAS.map((a) => <option key={a}>{a}</option>)}
          </select></label>
        <label className="text-xs text-slate-500">From<input type="date" className={input} aria-label="From" value={f.from} onChange={set("from")} /></label>
        <label className="text-xs text-slate-500">To<input type="date" className={input} aria-label="To" value={f.to} onChange={set("to")} /></label>
        <label className="text-xs text-slate-500">Search<input type="search" className={input} aria-label="Search logs" placeholder="e.g. V004, Annadanam" value={f.q} onChange={set("q")} /></label>
      </section>
      {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</p>}

      <section className={card} aria-label="Activity">
        {!rows ? <p className="p-6 text-sm text-slate-500">Loading…</p> : rows.length === 0 ? <p className="p-6 text-sm text-slate-400">Nothing matches these filters.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="p-3">When</th><th>Who</th>{superAdmin && <th>Workspace</th>}<th>Area</th><th>What</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (<Fragment key={r.id}>
                  <tr className="border-t border-slate-200 align-top" data-testid="log-row">
                    <td className="whitespace-nowrap p-3 text-slate-600">{new Date(r.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="py-3 pr-3">{r.actor_name ?? (r.actor ? "Former user" : "System")}</td>
                    {superAdmin && <td className="py-3 pr-3 text-slate-600">{r.workspace_name ?? "—"}</td>}
                    <td className="py-3 pr-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r.area}</span></td>
                    <td className="py-3 pr-3">
                      {r.summary}
                      {r.details && Object.keys(r.details).length > 0 && (
                        <button className="ml-2 text-xs text-indigo-600" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Hide" : "Details"}</button>)}
                    </td>
                  </tr>
                  {open === r.id && r.details && (
                    <tr className="bg-slate-50"><td colSpan={superAdmin ? 5 : 4} className="px-3 pb-3">
                      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
                        {Object.entries(r.details).map(([k, v]) => (<Fragment key={k}>
                          <dt className="font-medium text-slate-600">{k.replace(/_/g, " ")}</dt>
                          <dd className="break-all text-slate-700">{r.action === "changed" && Array.isArray(v) && v.length === 2 ? <>{show(v[0])} <span className="text-slate-400">→</span> {show(v[1])}</> : show(v)}</dd>
                        </Fragment>))}
                      </dl>
                    </td></tr>)}
                </Fragment>))}
              </tbody>
            </table>
          </div>
        )}
        {more && <div className="border-t border-slate-200 p-3 text-center"><button className={btnGhost} onClick={() => load(rows?.length ?? 0)}>Show older</button></div>}
      </section>
    </div>
  );
}
