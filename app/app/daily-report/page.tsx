"use client";
import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/db";
import { dmy } from "@/lib/format";
import { useWs } from "@/components/WorkspaceProvider";
import { btnGhost, btnPrimary, input } from "@/components/ui";

type Msg = { book: "all" | "temple" | "goshala" | "books"; message: string };
type Config = { enabled: boolean; telegram_chat_id: string | null; has_token: boolean; token_hint: string | null };
type LogRow = { id: string; created_at: string; kind: "scheduled" | "manual" | "test"; report_date: string | null; book: string | null; status: number | null; error: string | null; by_name: string | null };

const BOOK: Record<string, string> = { all: "All books", temple: "Temple", goshala: "Goshala", books: "Books" };
const KIND: Record<LogRow["kind"], string> = { scheduled: "3:30 AM", manual: "Sent by hand", test: "Test" };
const card = "rounded-lg border border-slate-200 bg-surface shadow-card";

/** Today's date in India, whatever the browser's clock zone. */
const indiaDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400e3).toISOString().slice(0, 10);

/**
 * The Mangalarti report: yesterday's income and expense, sent to the temple's Telegram group at 3:30 AM.
 * Everything shown here comes from the database — the preview is the very text the 3:30 job sends.
 */
export default function DailyReport() {
  const { ws, canAccount, canManage } = useWs();
  const [day, setDay] = useState(indiaDate(-1));
  // Kept with the day they belong to, so a new date never shows the last day's messages, nor a late reply.
  const [loaded, setLoaded] = useState<{ day: string; msgs: Msg[] } | null>(null);
  const msgs = loaded?.day === `${ws.id}|${day}` ? loaded.msgs : null;
  const [cfg, setCfg] = useState<Config | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [token, setToken] = useState(""); const [chat, setChat] = useState(""); const [enabled, setEnabled] = useState(false);
  const [found, setFound] = useState<{ id: string; title: string; type: string }[] | null>(null);
  const [busy, setBusy] = useState(""); const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    if (!canAccount) return;
    db.rpc("daily_report_messages", { p_ws: ws.id, p_day: day }).then(({ data, error }) => {
      if (error) setNote({ text: error.message, bad: true });
      setLoaded({ day: `${ws.id}|${day}`, msgs: error ? [] : (data as Msg[]) ?? [] });
    });
  }, [ws.id, day, canAccount]);

  const loadSettings = useCallback(async () => {
    if (!canManage) return;
    const [c, l] = await Promise.all([db.rpc("daily_report_config", { p_ws: ws.id }), db.rpc("daily_report_log", { p_ws: ws.id })]);
    const conf = ((c.data as Config[]) ?? [])[0] ?? null;
    setCfg(conf); setChat(conf?.telegram_chat_id ?? ""); setEnabled(!!conf?.enabled);
    setLog((l.data as LogRow[]) ?? []);
  }, [ws.id, canManage]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  if (!canAccount) return <p className={`${card} p-6 text-slate-600`}>Only owners, admins and the main accountant can see the daily report.</p>;

  const say = (text: string, bad = false) => setNote({ text, bad });
  async function rpc(label: string, name: string, args: Record<string, unknown>, ok: (d: unknown) => string) {
    setBusy(label); setNote(null);
    const { data, error } = await db.rpc(name, args);
    setBusy("");
    if (error) { say(error.message, true); return false; }
    say(ok(data)); await loadSettings();
    // Telegram's answer comes back a moment later; look again so the log shows whether it arrived.
    if (name.startsWith("send_")) setTimeout(loadSettings, 3000);
    return true;
  }
  const save = () => rpc("save", "set_daily_report", { p_ws: ws.id, p_enabled: enabled, p_chat_id: chat, p_token: token.trim() || null },
    () => { setToken(""); return enabled ? "Saved. The report will go out every day at 3:30 AM." : "Saved. The daily report is switched off."; });
  async function findGroup() {
    if (!token.trim()) return say("Paste the bot token first — it is only used for this look-up until you save.", true);
    setBusy("find"); setNote(null); setFound(null);
    try {
      const r = await fetch("/api/telegram/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token.trim() }) });
      const j = await r.json();
      if (!j.ok) return say(j.error ?? "Telegram refused the request.", true);
      setFound(j.chats);
      if (!j.chats.length) say("The bot has not seen any group yet. Add it to the group, send any message there, then try again.", true);
      else if (j.chats.length === 1) { setChat(j.chats[0].id); say(`Found “${j.chats[0].title}”.`); }
    } catch { say("Could not reach Telegram. Please try again.", true); } finally { setBusy(""); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold text-slate-800">Daily report</h1>
          <p className="text-sm text-slate-500">Announced at Mangalarti: every morning at 3:30 (India time) the previous day’s income and expense go to the Telegram group.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={btnGhost} aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>‹</button>
          <input type="date" aria-label="Report date" className={`${input} !w-auto`} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <button className={btnGhost} aria-label="Next day" onClick={() => setDay(addDays(day, 1))}>›</button>
        </div>
      </div>
      {note && <p role={note.bad ? "alert" : "status"} className={`rounded-md border p-2 text-sm ${note.bad ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{note.text}</p>}

      <section aria-label="Messages">
        <h2 className="mb-2 font-display text-lg font-bold text-slate-800">Messages for {dmy(day)}</h2>
        {!msgs ? <p className="text-sm text-slate-500">Loading…</p> : msgs.length === 0
          ? <p className={`${card} p-6 text-sm text-slate-500`}>No entries on this day, so nothing is sent.</p>
          : <div className="grid gap-4 lg:grid-cols-2">{msgs.map((m) => (
              <article key={m.book} className={`${card} flex flex-col`} aria-label={`${BOOK[m.book]} message`}>
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
                  <span className="text-sm font-semibold text-slate-700">{BOOK[m.book]}</span>
                  <button className="text-sm text-indigo-600" onClick={async () => { await navigator.clipboard.writeText(m.message); say(`${BOOK[m.book]} message copied.`); }}>Copy</button>
                </div>
                <pre className="flex-1 whitespace-pre-wrap p-4 font-sans text-sm leading-relaxed text-slate-800">{m.message}</pre>
              </article>))}</div>}
      </section>

      {canManage && (
        <section className={`${card} space-y-4 p-4`} aria-label="Telegram">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-slate-800">Telegram group</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg?.enabled ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`} data-testid="report-state">
              {cfg?.enabled ? "On — sends daily at 3:30 AM" : "Off"}
            </span>
          </div>
          <details className="text-sm text-slate-600" open={!cfg?.has_token}>
            <summary className="cursor-pointer font-medium text-slate-700">Setting up the bot</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>In Telegram, open <b>@BotFather</b>, send <code>/newbot</code> and name it <b>ISKM Pondicherry Reporting</b> (a new bot, not the trading bot).</li>
              <li>BotFather replies with a token like <code>123456789:AAF…</code>. Paste it below. It is kept in the database’s secret store and is never shown again.</li>
              <li>Add the bot to the reporting group and send any message there. Then press <b>Find my group</b>.</li>
              <li>Press <b>Send a test message</b>. When it arrives in the group, switch the daily report on and save.</li>
            </ol>
          </details>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">Bot token
              <input className={`${input} mt-1`} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
                placeholder={cfg?.has_token ? `Saved (${cfg.token_hint}) — paste a new one to replace it` : "123456789:AAF…"} />
            </label>
            <label className="text-xs font-medium text-slate-600">Group chat id
              <div className="mt-1 flex gap-2">
                <input className={input} value={chat} onChange={(e) => setChat(e.target.value)} placeholder="-1001234567890" />
                <button className={`${btnGhost} shrink-0`} onClick={findGroup} disabled={!!busy}>{busy === "find" ? "Looking…" : "Find my group"}</button>
              </div>
            </label>
          </div>
          {found && found.length > 1 && (
            <div className="flex flex-wrap gap-2 text-sm">{found.map((c) => (
              <button key={c.id} className={`${btnGhost} ${chat === c.id ? "!border-indigo-500" : ""}`} onClick={() => setChat(c.id)}>{c.title} <span className="text-xs text-slate-400">{c.id}</span></button>))}</div>
          )}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Send automatically every day at 3:30 AM (nothing is sent on a day with no entries)
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={save} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save"}</button>
            <button className={btnGhost} disabled={!!busy || !cfg?.has_token || !cfg?.telegram_chat_id}
              onClick={() => rpc("test", "send_daily_report_test", { p_ws: ws.id }, () => "Test message sent to Telegram.")}>Send a test message</button>
            <button className={btnGhost} disabled={!!busy || !cfg?.has_token || !cfg?.telegram_chat_id || !msgs?.length}
              onClick={() => rpc("now", "send_daily_report_now", { p_ws: ws.id, p_day: day }, (n) => `Sent ${n} message${n === 1 ? "" : "s"} for ${dmy(day)}.`)}>Send {dmy(day)} now</button>
            {cfg?.has_token && <button className="text-sm text-red-600" disabled={!!busy}
              onClick={() => rpc("remove", "set_daily_report", { p_ws: ws.id, p_enabled: false, p_chat_id: chat, p_token: "" }, () => "Bot token removed; the daily report is off.")}>Remove token</button>}
          </div>
          {(!cfg?.has_token || !cfg?.telegram_chat_id) && <p className="text-xs text-slate-500">Save the bot token and group chat id to send.</p>}
        </section>
      )}

      {canManage && (
        <section className={card} aria-label="Sent">
          <h2 className="border-b border-slate-200 p-4 font-display text-lg font-bold text-slate-800">Sent</h2>
          {log.length === 0 ? <p className="p-4 text-sm text-slate-400">Nothing sent yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">When</th><th>How</th><th>Report</th><th>Result</th></tr></thead>
              <tbody>{log.map((l) => (
                <tr key={l.id} className="border-t border-slate-200">
                  <td className="p-3 text-slate-600">{new Date(l.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td>{KIND[l.kind]}{l.by_name ? ` · ${l.by_name}` : ""}</td>
                  <td>{l.report_date ? `${dmy(l.report_date)} · ${BOOK[l.book ?? ""] ?? "—"}` : "—"}</td>
                  <td>{l.error ? <span className="text-red-700">✗ {l.error}</span> : l.status && l.status < 300 ? <span className="text-emerald-700">✓ Delivered</span> : <span className="text-slate-500">Waiting for Telegram…</span>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      )}
    </div>
  );
}
