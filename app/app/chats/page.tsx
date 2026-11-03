"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/db";
import type { ChatMsg, ChatThread } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { useWs } from "@/components/WorkspaceProvider";
import { Modal, btnGhost, btnPrimary, input } from "@/components/ui";

type Prof = { id: string; full_name: string | null; username: string | null };
const when = (iso: string) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };

export default function Chats() {
  const { profile } = useAuth();
  const { ws } = useWs();
  const [threads, setThreads] = useState<ChatThread[]>([]); const [profs, setProfs] = useState<Map<string, Prof>>(new Map());
  const [members, setMembers] = useState<Map<string, string[]>>(new Map());
  const [last, setLast] = useState<Map<string, ChatMsg>>(new Map()); const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [sel, setSel] = useState<string | null>(null); const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState(""); const [find, setFind] = useState(""); const [group, setGroup] = useState(false); const [msg, setMsg] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const { data: th, error: thErr } = await db.rpc("list_chat_threads", { p_ws: ws.id });
    if (thErr) { setMsg(thErr.message); return; }
    const list = ((th as ChatThread[]) ?? []).filter((t) => t.kind !== "workspace" || t.workspace_id === ws.id);
    const ids = list.map((t) => t.id);
    const [{ data: cm }, { data: lm }] = await Promise.all([
      db.from("chat_members").select("thread_id,user_id,last_read_at").in("thread_id", ids),
      db.from("chat_messages").select("*").in("thread_id", ids).order("created_at", { ascending: false }).limit(300),
    ]);
    const mm = new Map<string, string[]>(), rd = new Map<string, string>();
    ((cm as { thread_id: string; user_id: string; last_read_at: string }[]) ?? []).forEach((r) => { mm.set(r.thread_id, [...(mm.get(r.thread_id) ?? []), r.user_id]); if (r.user_id === profile.id) rd.set(r.thread_id, r.last_read_at); });
    const lastMap = new Map<string, ChatMsg>(), un = new Map<string, number>();
    ((lm as ChatMsg[]) ?? []).forEach((m) => { if (!lastMap.has(m.thread_id)) lastMap.set(m.thread_id, m); if (m.sender_id !== profile.id && m.created_at > (rd.get(m.thread_id) ?? "9")) un.set(m.thread_id, (un.get(m.thread_id) ?? 0) + 1); });
    const uids = [...new Set([...(cm as { user_id: string }[] ?? []).map((r) => r.user_id), ...(lm as ChatMsg[] ?? []).map((m) => m.sender_id).filter(Boolean) as string[]])];
    const { data: pr } = uids.length ? await db.from("profiles").select("id,full_name,username").in("id", uids) : { data: [] };
    setProfs(new Map(((pr as Prof[]) ?? []).map((p) => [p.id, p]))); setMembers(mm); setLast(lastMap); setUnread(un);
    setThreads(list.sort((a, b) => (a.kind === "workspace" ? -1 : b.kind === "workspace" ? 1 : (lastMap.get(b.id)?.created_at ?? "").localeCompare(lastMap.get(a.id)?.created_at ?? ""))));
    setSel((cur) => cur ?? list.find((t) => t.kind === "workspace")?.id ?? null);
  }, [ws.id, profile.id]);
  useEffect(() => { loadThreads(); }, [loadThreads]);

  const markRead = useCallback(async (t: string) => { await db.from("chat_members").upsert({ thread_id: t, user_id: profile.id, last_read_at: new Date().toISOString() }); window.dispatchEvent(new Event("ef-chat-read")); }, [profile.id]);
  const loadMsgs = useCallback(async (t: string) => {
    const { data } = await db.from("chat_messages").select("*").eq("thread_id", t).order("created_at", { ascending: true }).limit(300);
    setMsgs((data as ChatMsg[]) ?? []);
    setTimeout(() => bottom.current?.scrollIntoView({ block: "end" }), 50);
  }, []);
  useEffect(() => {
    if (!sel) return;
    loadMsgs(sel).then(() => markRead(sel).then(() => setUnread((u) => { const n = new Map(u); n.delete(sel); return n; })));
    const ch = db.channel(`thread-${sel}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${sel}` }, () => { loadMsgs(sel); markRead(sel); loadThreads(); }).subscribe();
    const poll = setInterval(() => loadMsgs(sel), 15000);
    return () => { db.removeChannel(ch); clearInterval(poll); };
  }, [sel, loadMsgs, markRead, loadThreads]);

  const nameOf = (id: string | null) => { const p = id ? profs.get(id) : null; return p ? p.full_name || (p.username ? "@" + p.username : "User") : "Former member"; };
  const titleOf = useCallback((t: ChatThread) => t.kind === "private" ? nameOf((members.get(t.id) ?? []).find((u) => u !== profile.id) ?? null) : t.title || "Group", [members, profs, profile.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = threads.find((t) => t.id === sel);
  const bubbles = useMemo(() => msgs, [msgs]);

  async function send(e: React.FormEvent) {
    e.preventDefault(); const body = text.trim(); if (!body || !sel) return; setText("");
    const { error } = await db.from("chat_messages").insert({ thread_id: sel, body, sender_id: profile.id });
    if (error) { setText(body); return alert(error.message); }
    loadMsgs(sel); markRead(sel); loadThreads();
  }
  async function startPrivate(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    const { data, error } = await db.rpc("start_private_chat", { p_username: find });
    if (error) return setMsg(error.message); setFind(""); await loadThreads(); setSel(data as string);
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">Chats</h1><button className={btnGhost} onClick={() => setGroup(true)}>+ Create group</button></div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <form onSubmit={startPrivate} className="flex gap-2"><input className={input} placeholder="Find a person by @username" value={find} onChange={(e) => setFind(e.target.value)} required /><button className={btnPrimary}>Chat</button></form>
          {msg && <p className="text-xs text-red-600">{msg}</p>}
          <div className="max-h-[60vh] overflow-y-auto rounded-xl border bg-white">
            {threads.map((t) => (
              <button key={t.id} onClick={() => setSel(t.id)} className={`block w-full border-b p-3 text-left text-sm last:border-0 hover:bg-slate-50 ${sel === t.id ? "bg-indigo-50" : ""}`}>
                <div className="flex items-center justify-between"><b className="truncate">{t.kind === "workspace" ? "👥 " : t.kind === "group" ? "🗨 " : ""}{titleOf(t)}</b>
                  {!!unread.get(t.id) && <span className="ml-2 rounded-full bg-indigo-600 px-2 text-xs text-white">{unread.get(t.id)}</span>}</div>
                <div className="truncate text-xs text-slate-500">{last.get(t.id) ? `${nameOf(last.get(t.id)!.sender_id)}: ${last.get(t.id)!.body}` : "No messages yet"}</div></button>))}
          </div>
          <p className="text-xs text-slate-500">Your @username is set in Settings → My account. People find you by it.</p>
        </div>
        <div className="flex h-[70vh] flex-col rounded-xl border bg-white md:col-span-2">
          {!current ? <div className="m-auto text-sm text-slate-400">Select a chat</div> : (<>
            <div className="border-b p-3 font-semibold">{titleOf(current)} <span className="text-xs font-normal text-slate-500">{current.kind === "workspace" ? "all workspace members" : `${(members.get(current.id) ?? []).length} people`}</span></div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {bubbles.map((m) => { const mine = m.sender_id === profile.id; return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                  {!mine && <div className="text-xs font-semibold text-indigo-700">{nameOf(m.sender_id)}</div>}<div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={`mt-0.5 text-[10px] ${mine ? "text-indigo-200" : "text-slate-500"}`}>{when(m.created_at)}</div></div></div>); })}
              {!bubbles.length && <div className="pt-10 text-center text-sm text-slate-400">Say Hare Krishna 🙏</div>}<div ref={bottom} /></div>
            <form onSubmit={send} className="flex gap-2 border-t p-3"><input className={input} placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} /><button className={btnPrimary}>Send</button></form></>)}
        </div>
      </div>
      {group && <GroupModal onClose={() => setGroup(false)} onCreated={async (id) => { setGroup(false); await loadThreads(); setSel(id); }} />}
    </div>
  );
}

function GroupModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState(""); const [names, setNames] = useState(""); const [err, setErr] = useState("");
  return (
    <Modal title="Create group" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const { data, error } = await db.rpc("create_group", { p_title: title.trim(), p_usernames: names.split(/[,\s]+/).filter(Boolean) }); if (error) return setErr(error.message); onCreated(data as string); }}>
        <input className={input} placeholder="Group name" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input className={input} placeholder="@usernames, separated by commas" value={names} onChange={(e) => setNames(e.target.value)} required />
        {err && <p className="text-sm text-red-600">{err}</p>}<div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary}>Create</button></div></form>
    </Modal>
  );
}
