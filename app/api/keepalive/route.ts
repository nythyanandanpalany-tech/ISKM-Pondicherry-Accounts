// Supabase pauses a project on the free plan after about a week with no activity. Vercel Cron
// calls this once a day (see vercel.json) so the database is never idle that long. One tiny
// request is enough; it returns no data of its own.

export async function GET(req: Request) {
  // Vercel Cron sends CRON_SECRET as a Bearer token when it is set. If it is not set the route
  // stays open: it returns no data, and refusing by default would silently break the cron job.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ ok: false, reason: "not configured" }, { status: 500 });
  try {
    const r = await fetch(`${url}/rest/v1/workspaces?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
    return Response.json({ ok: r.ok, status: r.status });
  } catch { return Response.json({ ok: false }, { status: 502 }); }
}
