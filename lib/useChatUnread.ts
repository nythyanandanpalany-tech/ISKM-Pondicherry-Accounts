"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Total unread chat messages for the signed-in user, kept fresh via realtime + polling. */
export function useChatUnread(userId: string, enabled: boolean, workspaceId: string) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    if (!enabled) return setUnread(0);
    const { data: mem } = await supabase.from("chat_members").select("thread_id,last_read_at").eq("user_id", userId);
    const rows = (mem as { thread_id: string; last_read_at: string }[]) ?? [];
    if (!rows.length) return setUnread(0);
    const oldest = rows.reduce((m, r) => (r.last_read_at < m ? r.last_read_at : m), rows[0].last_read_at);
    const { data: msgs } = await supabase.from("chat_messages").select("thread_id,sender_id,created_at").in("thread_id", rows.map((r) => r.thread_id)).gt("created_at", oldest).neq("sender_id", userId).limit(500);
    const last = new Map(rows.map((r) => [r.thread_id, r.last_read_at]));
    setUnread(((msgs as { thread_id: string; created_at: string }[]) ?? []).filter((m) => m.created_at > (last.get(m.thread_id) ?? "")).length);
  }, [userId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    supabase.rpc("ensure_workspace_thread", { p_ws: workspaceId }).then(() => refresh());
    const ch = supabase.channel(`unread-${userId}-${workspaceId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
      const m = payload.new as { sender_id: string | null; body: string };
      if (m.sender_id !== userId) {
        let on = false; try { on = localStorage.getItem("ef_alerts") === "1"; } catch { /* ignore */ }
        if (on && document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("ExpenseFlow", { body: m.body.slice(0, 120) });
      }
      refresh();
    }).subscribe();
    const poll = setInterval(refresh, 30000); window.addEventListener("ef-chat-read", refresh);
    return () => { supabase.removeChannel(ch); clearInterval(poll); window.removeEventListener("ef-chat-read", refresh); };
  }, [userId, enabled, workspaceId, refresh]);
  return unread;
}
