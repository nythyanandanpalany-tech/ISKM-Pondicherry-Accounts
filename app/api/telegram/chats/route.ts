// "Find my group" on the Daily report screen. Given a bot token the admin has just pasted, ask Telegram which
// groups the bot has been added to, so nobody has to dig a chat id out of getUpdates by hand.
//
// It stores nothing and logs nothing: the token arrives in the request body and is used for one call.
// The saved token never leaves the database (see 20260101000009_daily_report.sql).

type Chat = { id: number; title?: string; username?: string; type: string };
type Update = Record<string, { chat?: Chat } | undefined>;

const TOKEN = /^[0-9]{5,}:[A-Za-z0-9_-]{30,}$/;

export async function POST(req: Request) {
  let token = "";
  try { token = String((await req.json())?.token ?? "").trim(); } catch { /* fall through */ }
  if (!TOKEN.test(token)) return Response.json({ ok: false, error: "That does not look like a Telegram bot token." }, { status: 400 });

  // Overridable only so the end-to-end tests can stand in for Telegram.
  const base = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
  let body: { ok?: boolean; description?: string; result?: Update[] };
  try {
    const r = await fetch(`${base}/bot${token}/getUpdates?allowed_updates=${encodeURIComponent('["message","my_chat_member","channel_post"]')}`, { cache: "no-store" });
    body = await r.json();
  } catch {
    return Response.json({ ok: false, error: "Could not reach Telegram. Please try again." }, { status: 502 });
  }
  if (!body.ok) {
    const why = body.description ?? "Telegram refused the request";
    return Response.json({ ok: false, error: /unauthorized|not found/i.test(why) ? "Telegram does not recognise this bot token." : why }, { status: 400 });
  }
  const chats = new Map<string, { id: string; title: string; type: string }>();
  for (const u of body.result ?? []) {
    for (const k of ["message", "my_chat_member", "channel_post", "edited_message"]) {
      const c = u[k]?.chat;
      if (c && c.type !== "private") chats.set(String(c.id), { id: String(c.id), title: c.title ?? c.username ?? String(c.id), type: c.type });
    }
  }
  return Response.json({ ok: true, chats: [...chats.values()] });
}
