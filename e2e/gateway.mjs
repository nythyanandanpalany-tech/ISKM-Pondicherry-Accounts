// A stand-in for the parts of Supabase that are not the database, so the real app can run end to end
// on a laptop with nothing but PostgreSQL and PostgREST:
//
//   /rest/v1/*   -> PostgREST, which enforces the real row level security from supabase/schema.sql
//   /auth/v1/*   -> sign-in, session, user (a few fixed test people; see fixtures.mjs)
//   /storage/v1  -> not needed by these tests (no photos are uploaded)
//
// It signs the same kind of JWT Supabase Auth would, with the secret PostgREST is started with, so
// `auth.uid()` and the policies behave exactly as they do in production. It is a test tool: it knows
// nothing about passwords beyond the fixed test password, and it must never be pointed at real data.
import http from "node:http";
import crypto from "node:crypto";
import { PASSWORD, USERS } from "./fixtures.mjs";

const b64 = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");

export function startGateway({ port, postgrest, secret }) {
  const sign = (payload) => {
    const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
    return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
  };
  const verify = (token) => {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const good = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    if (good !== s) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    return claims.exp * 1000 > Date.now() ? claims : null;
  };
  const refreshTokens = new Map();
  const userJson = (u) => ({
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email" }, user_metadata: { full_name: u.name }, created_at: "2026-01-01T00:00:00Z",
  });
  const session = (u) => {
    const now = Math.floor(Date.now() / 1000), exp = now + 3600;
    const refresh = crypto.randomUUID();
    refreshTokens.set(refresh, u.id);
    return {
      access_token: sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, iat: now, exp }),
      token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: userJson(u),
    };
  };
  const byId = (id) => Object.values(USERS).find((u) => u.id === id);

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin ?? "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range,Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

    try {
      if (url.pathname.startsWith("/rest/v1/")) {
        const headers = {};
        for (const k of ["content-type", "accept", "prefer", "range", "accept-profile", "content-profile"]) if (req.headers[k]) headers[k] = req.headers[k];
        // A real JWT passes through; the anon key (not a JWT here) means "signed out".
        const bearer = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
        if (bearer && verify(bearer)) headers.authorization = `Bearer ${bearer}`;
        const r = await fetch(`${postgrest}${url.pathname.replace("/rest/v1", "")}${url.search}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : raw });
        const out = {};
        for (const k of ["content-type", "content-range", "content-location"]) if (r.headers.get(k)) out[k] = r.headers.get(k);
        res.writeHead(r.status, out);
        return res.end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
      }

      if (url.pathname === "/auth/v1/token") {
        const grant = url.searchParams.get("grant_type");
        const body = raw.length ? JSON.parse(raw.toString()) : {};
        if (grant === "password") {
          const u = Object.values(USERS).find((x) => x.email === String(body.email).trim().toLowerCase());
          if (!u || body.password !== PASSWORD) return json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
          return json(200, session(u));
        }
        if (grant === "refresh_token") {
          const id = refreshTokens.get(body.refresh_token);
          return id ? json(200, session(byId(id))) : json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        }
        return json(400, { msg: "unsupported grant" });
      }
      if (url.pathname === "/auth/v1/user") {
        const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
        return claims ? json(200, userJson(byId(claims.sub))) : json(401, { code: 401, msg: "invalid JWT" });
      }
      if (url.pathname === "/auth/v1/logout") { res.writeHead(204); return res.end(); }
      if (url.pathname.startsWith("/auth/v1/")) return json(400, { code: 400, msg: "not available in the end-to-end stack" });

      return json(404, { message: `the end-to-end stack has no ${url.pathname}` });
    } catch (e) {
      return json(502, { message: `gateway: ${e.message}` });
    }
  });
  // Realtime (chat) is not part of these tests; refuse the socket quietly so the app falls back.
  server.on("upgrade", (_req, socket) => socket.destroy());
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
