/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The app's one door to the backend: Supabase (Postgres + Auth + Storage).
 *   db.from("entries").select().eq("workspace_id", id)   db.rpc("create_workspace", { p_name })
 *   db.storage.from("receipts").upload(path, file)       db.auth.signInWithPassword({ email, password })
 *
 * `from`, `storage`, `channel` are the Supabase client's own, so every screen speaks plain
 * PostgREST. Permissions live in the database (supabase/schema.sql) as row level security, which
 * is why the browser may talk to Postgres directly. `auth` and `rpc` are thin wrappers that add
 * friendly error messages, the "remember me" choice, and the password re-check that changing a
 * password and deleting an account need.
 */
import { createClient, type Session } from "@supabase/supabase-js";
import { DUMMY_CATEGORIES, DUMMY_ENTRIES, DUMMY_ITEMS, DUMMY_MODE, DUMMY_PEOPLE } from "./dummyData";

type Row = Record<string, any>;
type Err = { message: string } | null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const configured = !!(url && key);
export { DUMMY_MODE };

// ---------- "remember me" ----------
// Supabase keeps the session in localStorage, which survives closing the browser. When the box is
// unticked we hand it sessionStorage instead, so the session dies with the tab. The choice itself
// lives in localStorage, since the next visit has to read it back before any session exists.
const PERSIST = "ef_persist";
const mem = new Map<string, string>();
const pick = () => (localStorage.getItem(PERSIST) === "0" ? sessionStorage : localStorage);
const storage = {
  getItem: (k: string) => { try { return pick().getItem(k); } catch { return mem.get(k) ?? null; } },
  setItem: (k: string, v: string) => { try { pick().setItem(k, v); } catch { mem.set(k, v); } },
  removeItem: (k: string) => { try { pick().removeItem(k); } catch { mem.delete(k); } },
};
const rememberMe = (on: boolean) => { try { localStorage.setItem(PERSIST, on ? "1" : "0"); } catch { /* ignore */ } };

const sb = createClient(url || "http://localhost:54321", key || "missing-anon-key", {
  auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

// ---------- friendly errors ----------
const PW_HINT = "Password must be at least 8 characters and include a letter and a number.";
const weakPw = (p: string) => p.length < 8 || !/[a-zA-Z]/.test(p) || !/[0-9]/.test(p);

/** Supabase/Postgres speak in codes and English sentences; sevaks should read plain language. */
const fail = (e: unknown): { message: string } => {
  const raw = (e as { message?: string })?.message ?? String(e ?? "Something went wrong.");
  const code = (e as { code?: string })?.code ?? "";
  const byCode: Record<string, string> = {
    "23505": "That record already exists.",
    "23503": "Something this refers to no longer exists. Refresh the page and try again.",
    "23514": "Those values are not allowed here. Please check them and try again.",
    "42501": "Not allowed. You may not have permission for this.",
    PGRST116: "That record no longer exists. Refresh the page and try again.",
    over_email_send_rate_limit: "Too many emails sent just now. Please wait a minute and try again.",
  };
  if (byCode[code]) return { message: byCode[code] };
  const has = (s: string) => raw.toLowerCase().includes(s);
  if (has("invalid login credentials")) return { message: "Wrong email or password." };
  if (has("email not confirmed")) return { message: "Please confirm your email first — check your inbox for the link." };
  if (has("user already registered") || has("already been registered")) return { message: "An account with this email already exists. Try signing in." };
  if (has("password should be") || has("password is too short")) return { message: PW_HINT };
  if (has("unable to validate email") || has("invalid email")) return { message: "That email address looks wrong." };
  if (has("rate limit") || has("you can only request this after") || has("too many requests")) return { message: "Too many attempts. Please wait a bit and try again." };
  if (has("row-level security")) return { message: "Not allowed. You may not have permission for this." };
  if (has("jwt expired") || has("invalid refresh token") || has("session") && has("expired")) return { message: "Your session has expired. Please sign in again." };
  if (has("failed to fetch") || has("network")) return { message: "No internet connection. Check your network and try again." };
  if (has("bucket not found")) return { message: "Photo storage is not set up yet. Run supabase/schema.sql in the Supabase SQL editor." };
  if (has("exceeded the maximum allowed size") || has("payload too large")) return { message: "That file is too large. Please photograph the bill instead (photos are compressed automatically)." };
  if (has("otp_expired") || has("expired") && has("link")) return { message: "That sign-in link has expired or was already used. Please request a new one." };
  if (has("signups not allowed") || has("signup is disabled")) return { message: "New accounts are switched off for this project. Ask an administrator to add you." };
  return { message: raw };
};
/** PostgREST hands errors back in the result rather than throwing; translate them in place. */
const soften = <T extends { error: unknown }>(r: T) => ({ ...r, error: r.error ? fail(r.error) : null }) as T & { error: Err };

// ---------- sample data mode (NEXT_PUBLIC_SEED_DUMMY_DATA=true) ----------
// Shows a handful of built-in records for demos and screenshots. Only the four tables below are
// faked, and writes are refused, so it can never touch real data. It implements just the filters
// those screens use; anything else is ignored rather than guessed at.
const DUMMY_TABLES: Record<string, Row[]> = { entries: DUMMY_ENTRIES, categories: DUMMY_CATEGORIES, items: DUMMY_ITEMS, people: DUMMY_PEOPLE };
const DUMMY_BLOCKED = { data: null, error: { message: "Sample data mode is on (NEXT_PUBLIC_SEED_DUMMY_DATA=true in .env) — this can't be edited. Set it to false to make real changes." } as Err };

function dummyBuilder(table: string) {
  const tests: ((r: Row) => boolean)[] = [];
  const sorts: { col: string; asc: boolean }[] = [];
  let cap: number | null = null;
  let one: "single" | "maybe" | null = null;
  let ws = "";

  const rows = () => {
    let out: Row[] = DUMMY_TABLES[table].map((r) => ({ ...r, workspace_id: ws || r.workspace_id }));
    out = out.filter((r) => tests.every((t) => t(r)));
    for (const s of [...sorts].reverse()) out.sort((a, b) => (a[s.col] > b[s.col] ? 1 : a[s.col] < b[s.col] ? -1 : 0) * (s.asc ? 1 : -1));
    return cap == null ? out : out.slice(0, cap);
  };
  const result = () => {
    const out = rows();
    if (one) {
      if (out.length === 1) return { data: out[0], error: null as Err };
      if (one === "maybe" && !out.length) return { data: null, error: null as Err };
      return { data: null, error: { message: "That record no longer exists. Refresh the page and try again." } as Err };
    }
    return { data: out, error: null as Err, count: out.length };
  };

  const b: Row = {
    select: () => b,
    eq: (c: string, v: unknown) => { if (c === "workspace_id") ws = String(v); tests.push((r) => String(r[c]) === String(v)); return b; },
    neq: (c: string, v: unknown) => { tests.push((r) => String(r[c]) !== String(v)); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.map(String).includes(String(r[c]))); return b; },
    gt: (c: string, v: any) => { tests.push((r) => r[c] > v); return b; },
    gte: (c: string, v: any) => { tests.push((r) => r[c] >= v); return b; },
    lt: (c: string, v: any) => { tests.push((r) => r[c] < v); return b; },
    lte: (c: string, v: any) => { tests.push((r) => r[c] <= v); return b; },
    is: (c: string, v: unknown) => { tests.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
    not: (c: string, op: string, v: unknown) => { if (op === "is" && v === null) tests.push((r) => r[c] != null); return b; },
    // Only the one shape the app uses: "col.not.is.null,other.not.is.null" — any of these is set.
    or: (expr: string) => {
      const cols = expr.split(",").map((p) => p.split(".")[0]);
      tests.push((r) => cols.some((c) => r[c] != null));
      return b;
    },
    order: (c: string, o?: { ascending?: boolean }) => { sorts.push({ col: c, asc: o?.ascending !== false }); return b; },
    limit: (n: number) => { cap = n; return b; },
    single: () => { one = "single"; return b; },
    maybeSingle: () => { one = "maybe"; return b; },
    insert: () => Promise.resolve(DUMMY_BLOCKED),
    update: () => Promise.resolve(DUMMY_BLOCKED),
    upsert: () => Promise.resolve(DUMMY_BLOCKED),
    delete: () => Promise.resolve(DUMMY_BLOCKED),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return b;
}

const from = (table: string) =>
  (DUMMY_MODE && DUMMY_TABLES[table] ? dummyBuilder(table) : sb.from(table)) as ReturnType<typeof sb.from>;

// ---------- auth ----------
/** The shape the screens expect: `session.user.emailVerified` rather than `email_confirmed_at`. */
const toSession = (s: Session | null) =>
  s ? { user: { id: s.user.id, email: s.user.email ?? "", emailVerified: !!s.user.email_confirmed_at } } : null;

const dbAuth = {
  async getSession() {
    const { data } = await sb.auth.getSession();
    return { data: { session: toSession(data.session) } };
  },
  onAuthStateChange(cb: (event: string, session: ReturnType<typeof toSession>) => void) {
    return sb.auth.onAuthStateChange((e, s) => cb(e, toSession(s)));
  },
  async signInWithPassword({ email, password, remember = true }: { email: string; password: string; remember?: boolean }) {
    rememberMe(remember);   // set before signing in, so the session is written to the right store
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    return { data: { session: toSession(data.session) }, error: error ? fail(error) : null };
  },
  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: { full_name?: string } } }) {
    if (weakPw(password)) return { data: { session: null }, error: { message: PW_HINT } as Err };
    rememberMe(true);
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: { data: options?.data, emailRedirectTo: `${location.origin}/app` },
    });
    return { data: { session: toSession(data.session) }, error: error ? fail(error) : null };
  },
  /** Passwordless sign-in: Supabase emails a link through the SMTP server set in the dashboard. */
  async signInWithOtp({ email, options }: { email: string; options?: { emailRedirectTo?: string } }) {
    rememberMe(true);
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: options?.emailRedirectTo ?? `${location.origin}/app` },
    });
    return { error: error ? fail(error) : null };
  },
  /**
   * Called when a page loads in case the browser arrived on a sign-in link. The client swaps the
   * code in the URL for a session by itself (detectSessionInUrl), and getSession waits for that to
   * finish, so this only has to report the outcome — and any error the link carried back.
   */
  async completeEmailLink() {
    try {
      const u = new URL(location.href);
      const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
      const linkErr = u.searchParams.get("error_description") ?? hash.get("error_description");
      if (linkErr) return { signedIn: false, error: fail({ message: linkErr }) };
      const arrived = !!(u.searchParams.get("code") ?? hash.get("access_token"));
      if (!arrived) return { signedIn: false, error: null as Err };
      const { data } = await sb.auth.getSession();
      return { signedIn: !!data.session, error: null as Err };
    } catch {
      return { signedIn: false, error: null as Err };
    }
  },
  /** Postgres never sees the password, so prove the current one by signing in with it first. */
  async updateUser({ password, currentPassword }: { password: string; currentPassword: string }) {
    if (weakPw(password)) return { error: { message: PW_HINT } as Err };
    const check = await dbAuth.reauth(currentPassword);
    if (check) return { error: check };
    const { error } = await sb.auth.updateUser({ password });
    return { error: error ? fail(error) : null };
  },
  async reauth(password: string): Promise<Err> {
    const { data } = await sb.auth.getUser();
    const email = data.user?.email;
    if (!email) return { message: "Please sign in again, then retry." };
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? { message: "Wrong password." } : null;
  },
  async sendVerificationEmail() {
    const { data } = await sb.auth.getUser();
    const email = data.user?.email;
    if (!email) return { error: { message: "Please sign in again, then retry." } as Err };
    const { error } = await sb.auth.resend({ type: "signup", email });
    return { error: error ? fail(error) : null };
  },
  /** After the user clicks the confirmation link in another tab, pull their status again. */
  async reloadUser() {
    await sb.auth.refreshSession();
    const { data } = await sb.auth.getUser();
    return data.user ? { user: { id: data.user.id, email: data.user.email ?? "", emailVerified: !!data.user.email_confirmed_at } } : null;
  },
  async signOut() {
    const { error } = await sb.auth.signOut();
    return { error: error ? fail(error) : null };
  },
};

// ---------- rpc ----------
async function rpc(name: string, args: Row = {}) {
  // Deleting an account is irreversible, so make the password prove who is asking. The database
  // function takes no arguments; the check happens here, where the password can be verified.
  if (name === "delete_account") {
    const wrong = await dbAuth.reauth(String(args.p_password ?? ""));
    if (wrong) return { data: null, error: wrong };
    args = {};
  }
  const { data, error } = await sb.rpc(name, args);
  return { data, error: error ? fail(error) : null };
}

export const db = {
  from,
  rpc,
  auth: dbAuth,
  storage: {
    from: (bucket: string) => {
      const b = sb.storage.from(bucket);
      return {
        upload: (path: string, file: File | Blob, opts?: { contentType?: string }) => b.upload(path, file, opts).then(soften),
        download: (path: string) => b.download(path).then(soften),
        remove: (paths: string[]) => b.remove(paths).then(soften),
        createSignedUrl: (path: string, expiresIn: number) => b.createSignedUrl(path, expiresIn).then(soften),
        list: (prefix?: string) => b.list(prefix).then(soften),
      };
    },
  },
  channel: sb.channel.bind(sb),
  removeChannel: sb.removeChannel.bind(sb),
};
