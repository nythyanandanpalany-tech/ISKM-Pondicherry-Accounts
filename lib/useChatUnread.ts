"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "./db";

/** Total unread chat messages for the signed-in user. Polls every 15 s (and when a chat is opened). */
export function useChatUnread(userId: string, enabled: boolean, workspaceId: string) {
  const [unread, setUnread] = useState(0);
  const prev = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled) return setUnread(0);
    const { data: mem } = await db.from("chat_members").select("thread_id,last_read_at").eq("user_id", userId);
    const rows = (mem as { thread_id: string; last_read_at: string }[]) ?? [];
    if (!rows.length) return setUnread(0);
    const oldest = rows.reduce((m, r) => (r.last_read_at < m ? r.last_read_at : m), rows[0].last_read_at);
    const { data: msgs } = await db.from("chat_messages").select("thread_id,sender_id,body,created_at").in("thread_id", rows.map((r) => r.thread_id)).gt("created_at", oldest).neq("sender_id", userId).limit(500);
    const last = new Map(rows.map((r) => [r.thread_id, r.last_read_at]));
    const fresh = ((msgs as { thread_id: string; body: string; created_at: string }[]) ?? []).filter((m) => m.created_at > (last.get(m.thread_id) ?? ""));
    if (fresh.length > prev.current) {
      let on = false; try { on = localStorage.getItem("ef_alerts") === "1"; } catch { /* ignore */ }
      if (on && document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("ExpenseFlow", { body: fresh[0].body.slice(0, 120) });
    }
    prev.current = fresh.length; setUnread(fresh.length);
  }, [userId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    db.rpc("ensure_workspace_thread", { p_ws: workspaceId }).then(() => refresh());
    const poll = setInterval(refresh, 15000); window.addEventListener("ef-chat-read", refresh);
    return () => { clearInterval(poll); window.removeEventListener("ef-chat-read", refresh); };
  }, [workspaceId, enabled, refresh]);
  return unread;
}
