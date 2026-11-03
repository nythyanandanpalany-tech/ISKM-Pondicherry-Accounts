// Route handlers are dynamic by default in Next 16. Pinged once a day by Vercel Cron (see vercel.json). Supabase's free plan pauses a project after
// ~7 days with no activity; one tiny API request a day keeps it awake. Returns no data.

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ ok: false, reason: "not configured" }, { status: 500 });
  try {
    const r = await fetch(`${url}/rest/v1/workspaces?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
    return Response.json({ ok: r.ok, status: r.status });
  } catch { return Response.json({ ok: false }, { status: 502 }); }
}
