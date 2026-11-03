/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A small query layer over Firebase (Auth + Firestore + Storage) that exposes the call style the screens use:
 *   db.from("entries").select().eq("workspace_id", id).order("entry_date", { ascending: false })
 *   db.rpc("create_workspace", {...})   db.storage.from("receipts").upload(...)   db.auth.signInWithPassword(...)
 * Notes
 *  - Collections are flat (documents carry workspace_id); membership/roles are enforced by firebase/firestore.rules.
 *  - Only equality filters go to Firestore (no composite indexes needed). Everything else (sorting, ranges, OR) runs in the browser,
 *    so a list screen reads every matching document. Fine for a temple's volume; paginate later if reads become a cost.
 *  - `in` filters fan out into one equality query per value so the security rules can verify each one.
 */
import {
  collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, updateDoc, where, writeBatch,
  type DocumentReference, type QueryConstraint,
} from "firebase/firestore";
import {
  EmailAuthProvider, createUserWithEmailAndPassword, deleteUser, isSignInWithEmailLink, onAuthStateChanged, reauthenticateWithCredential,
  sendSignInLinkToEmail, signInWithEmailAndPassword, signInWithEmailLink, signOut as fbSignOut, updatePassword, type User,
} from "firebase/auth";
import { deleteObject, getBlob, getDownloadURL, getMetadata, listAll, ref, uploadBytes } from "firebase/storage";
import { auth, configured, fs, storage } from "./firebase";

export { configured };
type Row = Record<string, any>;
type Err = { message: string } | null;
type Res<T = any> = { data: T; error: Err; count?: number | null };

const COL: Record<string, string> = { profiles: "users", bank_transactions: "bank_transactions" };
const colName = (t: string) => COL[t] ?? t;
const UNIQUE: Record<string, string[]> = { categories: ["workspace_id", "kind", "name"], items: ["category_id", "name"], people: ["workspace_id", "name"], stores: ["workspace_id", "name"], store_items: ["store_id", "name"] };
const WS_CHILDREN = ["entries", "entry_log", "bank_transactions", "stock_moves", "store_items", "stores", "items", "categories", "people"];
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const me = () => auth.currentUser?.uid ?? null;
const clean = (o: Row) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]));
const fail = (e: unknown): { message: string } => {
  const code = (e as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "Wrong email or password.", "auth/wrong-password": "Wrong email or password.", "auth/user-not-found": "Wrong email or password.",
    "auth/email-already-in-use": "An account with this email already exists. Try signing in.", "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "That email address looks wrong.", "auth/too-many-requests": "Too many attempts. Please wait a bit and try again.",
    "permission-denied": "Not allowed. You may not have permission for this.", "auth/requires-recent-login": "Please sign out, sign in again, then retry.",
  };
  return { message: map[code] ?? (e as Error)?.message ?? "Something went wrong" };
};

// ---------- filters ----------
type Filter = { col: string; op: "eq" | "neq" | "in" | "null" | "notnull" | "gt" | "gte" | "lt" | "lte"; val?: any } | { or: Filter[] };
const cmp = (a: any, b: any) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1);
function test(row: Row, f: Filter): boolean {
  if ("or" in f) return f.or.some((x) => test(row, x));
  const v = row[f.col];
  switch (f.op) {
    case "eq": return v === f.val || (f.val == null && v == null);
    case "neq": return v !== f.val;
    case "in": return (f.val as any[]).includes(v);
    case "null": return v == null;
    case "notnull": return v != null;
    case "gt": return v != null && v > f.val; case "gte": return v != null && v >= f.val;
    case "lt": return v != null && v < f.val; case "lte": return v != null && v <= f.val;
  }
}
function parseOr(s: string): Filter {
  return { or: s.split(",").map((p) => {
    const m = p.match(/^(\w+)\.(not\.is|is|eq|neq)\.(.*)$/)!; const val = m[3] === "null" ? null : m[3];
    return m[2] === "not.is" ? { col: m[1], op: "notnull" as const } : m[2] === "is" ? { col: m[1], op: "null" as const } : { col: m[1], op: m[2] as "eq" | "neq", val };
  }) };
}

// ---------- membership cache (for rule-friendly scoping of entries) ----------
const memCache = new Map<string, { at: number; role: string | null; seeAll: boolean }>();
async function myMembership(ws: string) {
  const c = memCache.get(ws); if (c && Date.now() - c.at < 60000) return c;
  const u = me(); let v = { at: Date.now(), role: null as string | null, seeAll: false };
  if (u) { const s = await getDoc(doc(fs, "members", `${ws}_${u}`)); if (s.exists()) { const d = s.data(); v = { at: Date.now(), role: d.role, seeAll: d.role === "owner" || d.role === "admin" || !!d.see_all }; } }
  memCache.set(ws, v); return v;
}

// ---------- reading ----------
async function fetchRows(table: string, filters: Filter[]): Promise<Row[]> {
  const simple = filters.filter((f): f is Extract<Filter, { col: string }> => "col" in f);
  const eqs = simple.filter((f) => f.op === "eq" && f.val != null);
  const rest = filters.filter((f) => !eqs.includes(f as any));
  const idEq = eqs.find((f) => f.col === "id");
  let rows: Row[] = [];

  if (table === "store_stock") {
    const r = await fetchRows("store_items", filters.filter((f) => !("col" in f) || f.col !== "store_item_id"));
    return r.map((x) => ({ store_item_id: x.id, workspace_id: x.workspace_id, qty: x.qty ?? 0 }));
  }
  if (table === "workspaces" && !idEq) {
    const u = me(); if (!u) return [];
    const ms = await getDocs(query(collection(fs, "members"), where("user_id", "==", u)));
    const ws = await Promise.all(ms.docs.map((m) => getDoc(doc(fs, "workspaces", m.data().workspace_id))));
    rows = ws.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));
  } else if (idEq) {
    const s = await getDoc(doc(fs, colName(table), String(idEq.val)));
    rows = s.exists() ? [{ id: s.id, ...s.data() }] : [];
  } else {
    const inF = rest.find((f): f is Extract<Filter, { col: string }> => "col" in f && f.op === "in" && f.col !== "id");
    const inId = rest.find((f): f is Extract<Filter, { col: string }> => "col" in f && f.op === "in" && f.col === "id");
    const cons: QueryConstraint[] = eqs.map((f) => where((f as any).col, "==", (f as any).val));
    const wsEq = eqs.find((f) => (f as any).col === "workspace_id");
    if (table === "entries" && wsEq) { const m = await myMembership((wsEq as any).val); if (m.role && !m.seeAll && !eqs.some((f) => (f as any).col === "created_by")) cons.push(where("created_by", "==", me())); }
    if (inId) {
      const snaps = await Promise.all((inId.val as string[]).map((id) => getDoc(doc(fs, colName(table), id))));
      rows = snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));
    } else if (inF) {
      const parts = await Promise.all((inF.val as any[]).map((v) => getDocs(query(collection(fs, colName(table)), ...cons, where(inF.col, "==", v)))));
      rows = parts.flatMap((p) => p.docs.map((d) => ({ id: d.id, ...d.data() })));
    } else {
      const snap = await getDocs(query(collection(fs, colName(table)), ...cons));
      rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  }
  return rows.filter((r) => filters.every((f) => test(r, f)));
}

// ---------- the query builder ----------
class Q implements PromiseLike<Res> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private values: any; private filters: Filter[] = []; private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null; private one: null | "single" | "maybe" = null; private head = false; private wantCount = false; private returning = false;
  private cols = "*";
  constructor(private table: string) {}
  select(cols = "*", opts?: { count?: string; head?: boolean }) { if (this.op !== "select") this.returning = true; this.cols = cols; this.head = !!opts?.head; this.wantCount = !!opts?.count; return this; }
  insert(v: Row | Row[]) { this.op = "insert"; this.values = v; return this; }
  upsert(v: Row | Row[]) { this.op = "upsert"; this.values = v; return this; }
  update(v: Row) { this.op = "update"; this.values = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, val: any) { this.filters.push({ col, op: "eq", val }); return this; }
  neq(col: string, val: any) { this.filters.push({ col, op: "neq", val }); return this; }
  in(col: string, val: any[]) { this.filters.push({ col, op: "in", val }); return this; }
  is(col: string, val: null) { this.filters.push({ col, op: "null" }); void val; return this; }
  not(col: string, ...rest: unknown[]) { void rest; this.filters.push({ col, op: "notnull" }); return this; }
  gt(col: string, val: any) { this.filters.push({ col, op: "gt", val }); return this; }
  gte(col: string, val: any) { this.filters.push({ col, op: "gte", val }); return this; }
  lt(col: string, val: any) { this.filters.push({ col, op: "lt", val }); return this; }
  lte(col: string, val: any) { this.filters.push({ col, op: "lte", val }); return this; }
  or(s: string) { this.filters.push(parseOr(s)); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.orders.push({ col, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, bad?: ((r: any) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, bad);
  }

  private shape(rows: Row[]): Res {
    if (this.one) {
      if (rows.length === 0) return this.one === "single" ? { data: null, error: { message: "No rows found" } } : { data: null, error: null };
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }
  private async run(): Promise<Res> {
    try {
      if (this.op === "select") return await this.runSelect();
      if (this.op === "insert" || this.op === "upsert") return await this.runInsert();
      return await this.runMutate();
    } catch (e) { return { data: null, error: fail(e) }; }
  }
  private async runSelect(): Promise<Res> {
    let rows = await fetchRows(this.table, this.filters);
    for (const o of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col]));
    const count = rows.length;
    if (this.lim != null) rows = rows.slice(0, this.lim);
    if (this.cols.includes("profiles(")) {
      rows = await Promise.all(rows.map(async (r) => { const s = await getDoc(doc(fs, "users", r.user_id)); return { ...r, profiles: s.exists() ? { full_name: s.data().full_name, email: s.data().email } : null }; }));
    }
    if (this.head) return { data: null, error: null, count };
    const res = this.shape(rows); res.count = this.wantCount ? count : undefined; return res;
  }
  private async checkUnique(r: Row) {
    const u = UNIQUE[this.table]; if (!u) return;
    const cols = u.includes("workspace_id") ? u : ["workspace_id", ...u]; // always scope by workspace so the security rules can verify the query
    const hit = (await fetchRows(this.table, cols.map((c) => ({ col: c, op: "eq" as const, val: r[c] })))).filter((x) => x.id !== r.id);
    if (hit.length) throw new Error(`“${r[u[u.length - 1]]}” already exists`);
  }
  private defaults(r: Row): Row {
    const d: Row = { id: r.id ?? uuid(), created_at: nowIso() };
    if (this.table === "entries") Object.assign(d, { created_by: me(), updated_at: nowIso(), receipt_available: false, payment_mode: "Cash", claim_status: null, claim_settled_at: null, note: null, reference_no: null, fund_source: null, beneficiary: null, bill_path: null, payment_proof_path: null, category_id: null, item_id: null, person_id: null });
    if (this.table === "stock_moves") Object.assign(d, { created_by: me() });
    if (this.table === "feedback") Object.assign(d, { user_id: me() });
    if (this.table === "bank_transactions") Object.assign(d, { direction: "debit", matched_entry_id: null });
    if (this.table === "store_items") Object.assign(d, { qty: 0 });
    return clean({ ...d, ...r });
  }
  private async runInsert(): Promise<Res> {
    const list = (Array.isArray(this.values) ? this.values : [this.values]) as Row[];
    if (this.table === "chat_members") {
      for (const r of list) await setDoc(doc(fs, "chat_members", `${r.thread_id}_${r.user_id}`), clean(r), { merge: true });
      return this.shape(list);
    }
    const out: Row[] = [];
    if (this.table === "stock_moves") {
      for (const r of list) out.push(await addStockMove(this.defaults(r)));
      return this.shape(out);
    }
    for (let i = 0; i < list.length; i += 450) {
      const b = writeBatch(fs);
      for (const r of list.slice(i, i + 450)) {
        const row = this.defaults(r); await this.checkUnique(row);
        b.set(doc(fs, colName(this.table), row.id), row); out.push(row);
      }
      await b.commit();
    }
    if (this.table === "members") memCache.clear();
    return this.shape(out);
  }
  private async targets(): Promise<Row[]> {
    const f = this.filters; const get = (c: string) => (f.find((x): x is Extract<Filter, { col: string }> => "col" in x && x.col === c && x.op === "eq") as any)?.val;
    if (this.table === "members" && get("workspace_id") && get("user_id")) {
      const s = await getDoc(doc(fs, "members", `${get("workspace_id")}_${get("user_id")}`)); return s.exists() ? [{ id: s.id, ...s.data() }] : [];
    }
    return fetchRows(this.table, f);
  }
  private async runMutate(): Promise<Res> {
    const rows = await this.targets();
    if (this.table === "profiles" && this.op === "update") return await updateProfile(rows[0], this.values);
    if (this.op === "delete") {
      if (this.table === "workspaces") { for (const r of rows) await deleteWorkspaceCascade(r.id); return { data: null, error: null }; }
      if (this.table === "stock_moves") { for (const r of rows) await removeStockMove(r); return { data: null, error: null }; }
      for (const r of rows) await deleteWithCascade(this.table, r);
      if (this.table === "members") memCache.clear();
      return { data: null, error: null };
    }
    // update
    for (let i = 0; i < rows.length; i += 200) {
      const b = writeBatch(fs);
      for (const r of rows.slice(i, i + 200)) {
        if (this.table === "entries") b.set(doc(fs, "entry_log", uuid()), clean({ id: uuid(), workspace_id: r.workspace_id, entry_id: r.id, action: "updated", snapshot: JSON.stringify(r), by_user: me(), at: nowIso() }));
        const v: Row = clean({ ...this.values }); if (this.table === "entries") v.updated_at = nowIso();
        b.update(doc(fs, colName(this.table), r.id), v);
      }
      await b.commit();
    }
    if (this.table === "members") memCache.clear();
    return { data: null, error: null };
  }
}

// ---------- special cases ----------
async function updateProfile(row: Row | undefined, values: Row): Promise<Res> {
  const u = me(); if (!u || !row || row.id !== u) return { data: null, error: { message: "Not allowed" } };
  const b = writeBatch(fs);
  if ("username" in values) {
    const next = values.username ? String(values.username).toLowerCase().replace(/^@/, "") : null;
    if (next && !/^[a-z0-9_.]{3,30}$/.test(next)) return { data: null, error: { message: "Username: 3–30 letters, numbers, _ or ." } };
    if (next !== (row.username ?? null)) {
      if (next) { const s = await getDoc(doc(fs, "usernames", next)); if (s.exists() && s.data().uid !== u) return { data: null, error: { message: "That username is taken" } }; b.set(doc(fs, "usernames", next), { uid: u }); }
      if (row.username) b.delete(doc(fs, "usernames", row.username));
    }
    values = { ...values, username: next };
  }
  b.update(doc(fs, "users", u), clean(values)); await b.commit(); return { data: null, error: null };
}

async function addStockMove(r: Row): Promise<Row> {
  const itemRef = doc(fs, "store_items", r.store_item_id);
  await runTransaction(fs, async (t) => {
    const it = await t.get(itemRef); if (!it.exists()) throw new Error("Item not found");
    const cur = it.data().qty ?? 0; const next = cur + (r.direction === "in" ? r.qty : -r.qty);
    if (next < 0) throw new Error(`Not enough stock: only ${cur} available`);
    t.update(itemRef, { qty: next }); t.set(doc(fs, "stock_moves", r.id), r);
  });
  return r;
}
async function removeStockMove(r: Row) {
  const itemRef = doc(fs, "store_items", r.store_item_id);
  await runTransaction(fs, async (t) => {
    const it = await t.get(itemRef); const cur = it.exists() ? it.data().qty ?? 0 : 0; const next = cur + (r.direction === "in" ? -r.qty : r.qty);
    if (next < 0) throw new Error("Cannot delete: later stock-outs depend on this stock-in");
    if (it.exists()) t.update(itemRef, { qty: next }); t.delete(doc(fs, "stock_moves", r.id));
  });
}
async function setNull(table: string, field: string, id: string, ws: string) {
  const rows = await fetchRows(table, [{ col: "workspace_id", op: "eq", val: ws }, { col: field, op: "eq", val: id }]);
  for (let i = 0; i < rows.length; i += 450) { const b = writeBatch(fs); rows.slice(i, i + 450).forEach((r) => b.update(doc(fs, table, r.id), { [field]: null })); await b.commit(); }
}
async function deleteWithCascade(table: string, r: Row) {
  const ws = r.workspace_id;
  if (table === "entries") {
    await setDoc(doc(fs, "entry_log", uuid()), clean({ workspace_id: ws, entry_id: r.id, action: "deleted", snapshot: JSON.stringify(r), by_user: me(), at: nowIso() }));
    await setNull("bank_transactions", "matched_entry_id", r.id, ws);
  } else if (table === "categories") {
    for (const it of await fetchRows("items", [{ col: "workspace_id", op: "eq", val: ws }, { col: "category_id", op: "eq", val: r.id }])) await deleteWithCascade("items", it);
    await setNull("entries", "category_id", r.id, ws);
  } else if (table === "items") { await setNull("entries", "item_id", r.id, ws); }
  else if (table === "people") { await setNull("entries", "person_id", r.id, ws); }
  else if (table === "stores") { for (const it of await fetchRows("store_items", [{ col: "workspace_id", op: "eq", val: ws }, { col: "store_id", op: "eq", val: r.id }])) await deleteWithCascade("store_items", it); }
  else if (table === "store_items") { for (const m of await fetchRows("stock_moves", [{ col: "workspace_id", op: "eq", val: ws }, { col: "store_item_id", op: "eq", val: r.id }])) await deleteDoc(doc(fs, "stock_moves", m.id)); }
  await deleteDoc(doc(fs, colName(table), r.id));
}
async function deleteWorkspaceCascade(wid: string) {
  for (const t of WS_CHILDREN) {
    const rows = await fetchRows(t, [{ col: "workspace_id", op: "eq", val: wid }]);
    for (let i = 0; i < rows.length; i += 450) { const b = writeBatch(fs); rows.slice(i, i + 450).forEach((r) => b.delete(doc(fs, colName(t), r.id))); await b.commit(); }
  }
  const others = await getDocs(query(collection(fs, "members"), where("workspace_id", "==", wid)));
  const mine = `${wid}_${me()}`;
  for (const m of others.docs.filter((d) => d.id !== mine)) await deleteDoc(m.ref);
  await deleteDoc(doc(fs, "workspaces", wid));
  await deleteDoc(doc(fs, "members", mine));
  memCache.clear();
}

// ---------- RPCs ----------
const EXPENSE_CATS = ["Groceries & Provisions", "Vegetables & Annadanam", "Puja Supplies", "Utilities", "Maintenance & Repairs", "Festival & Events", "Travel", "Printing & Stationery", "Salaries & Honorarium", "Suspense", "Other"];
const INCOME_CATS = ["Donation", "Hundi", "Seva", "Other Income"];
async function createWorkspace(name: string, org = "Temple", extra: Row = {}): Promise<string> {
  const u = me(); if (!u) throw new Error("Not signed in");
  const wid = uuid(); const b1 = writeBatch(fs);
  b1.set(doc(fs, "workspaces", wid), { id: wid, name, currency: "₹", date_format: "DD/MM/YYYY", org_type: org, monthly_budget: null, primary_purchaser: null, letterhead: null, modules: { store: true, chats: true }, is_demo: false, created_by: u, created_at: nowIso(), ...extra });
  b1.set(doc(fs, "members", `${wid}_${u}`), { workspace_id: wid, user_id: u, role: "owner", see_all: true, can_download: true, created_at: nowIso() });
  await b1.commit(); memCache.clear();
  const b2 = writeBatch(fs);
  for (const [kind, names] of [["expense", EXPENSE_CATS], ["income", INCOME_CATS]] as const) for (const n of names) { const id = uuid(); b2.set(doc(fs, "categories", id), { id, workspace_id: wid, name: n, kind, monthly_limit: null, created_at: nowIso() }); }
  await b2.commit(); return wid;
}
async function ensureWorkspaceThread(ws: string): Promise<string> {
  const u = me()!; const id = `ws_${ws}`; const r = doc(fs, "chat_threads", id);
  if (!(await getDoc(r)).exists()) {
    const w = await getDoc(doc(fs, "workspaces", ws));
    try { await setDoc(r, { id, kind: "workspace", workspace_id: ws, title: w.data()?.name ?? "Workspace", member_ids: [], created_by: u, created_at: nowIso() }); }
    catch (e) { if (!(await getDoc(r)).exists()) throw e; } // lost a race with another member creating it: fine
  }
  await setDoc(doc(fs, "chat_members", `${id}_${u}`), { thread_id: id, user_id: u, last_read_at: nowIso() }, { merge: true });
  return id;
}
async function uidByUsername(name: string): Promise<string> {
  const n = name.trim().replace(/^@/, "").toLowerCase(); const s = await getDoc(doc(fs, "usernames", n));
  if (!s.exists()) throw new Error(`No user with username ${n || "(empty)"}`); return s.data().uid;
}
async function makeThread(id: string, kind: "private" | "group", title: string | null, members: string[]) {
  const u = me()!; const r = doc(fs, "chat_threads", id);
  if (!(await getDoc(r)).exists()) await setDoc(r, { id, kind, workspace_id: null, title, member_ids: members, created_by: u, created_at: nowIso() });
  for (const m of members) await setDoc(doc(fs, "chat_members", `${id}_${m}`), { thread_id: id, user_id: m, last_read_at: m === u ? nowIso() : "1970-01-01T00:00:00.000Z" }, { merge: true });
  return id;
}
async function createSample(): Promise<string> {
  const w = await createWorkspace("Sri Rama Temple Trust [demo]", "Temple", { is_demo: true, monthly_budget: 60000 });
  const u = me()!; const cats = await fetchRows("categories", [{ col: "workspace_id", op: "eq", val: w }]);
  const cid = (n: string) => cats.find((c) => c.name === n)!.id;
  const b = writeBatch(fs); const mk = (t: string, r: Row) => { const id = uuid(); b.set(doc(fs, t, id), { id, workspace_id: w, created_at: nowIso(), ...r }); return id; };
  b.update(doc(fs, "categories", cid("Vegetables & Annadanam")), { monthly_limit: 25000 }); b.update(doc(fs, "categories", cid("Puja Supplies")), { monthly_limit: 15000 });
  const item = mk("items", { category_id: cid("Vegetables & Annadanam"), name: "Rice", monthly_limit: null });
  const p1 = mk("people", { name: "Ramesh" }), p2 = mk("people", { name: "Sita Devi" });
  const base = { created_by: u, updated_at: nowIso(), receipt_available: false, bill_path: null, payment_proof_path: null, claim_status: null, claim_settled_at: null, reference_no: null, fund_source: null, beneficiary: null, item_id: null, note: null };
  for (let d = 0; d < 7; d++) mk("entries", { ...base, type: "expense", entry_date: new Date(Date.now() - d * 86400000).toISOString().slice(0, 10), amount: 800 + d * 150, category_id: cid("Vegetables & Annadanam"), item_id: item, person_id: p1, payment_mode: d % 2 ? "Cash" : "UPI", note: "Sample purchase" });
  mk("entries", { ...base, type: "expense", entry_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), amount: 1200, category_id: cid("Puja Supplies"), person_id: p2, payment_mode: "Cash", note: "Flowers & incense (own pocket)", claim_status: "submitted" });
  mk("entries", { ...base, type: "income", entry_date: new Date().toISOString().slice(0, 10), amount: 5000, category_id: cid("Donation"), person_id: p2, payment_mode: "UPI", reference_no: "R-1001" });
  await b.commit(); return w;
}
async function removeSample() { for (const w of await fetchRows("workspaces", [])) if (w.is_demo && w.created_by === me()) await deleteWorkspaceCascade(w.id); }
async function deleteAccount() {
  const u = auth.currentUser!; const ms = await getDocs(query(collection(fs, "members"), where("user_id", "==", u.uid)));
  for (const m of ms.docs) {
    if (m.data().role !== "owner") continue;
    const others = (await getDocs(query(collection(fs, "members"), where("workspace_id", "==", m.data().workspace_id)))).docs.filter((x) => x.id !== m.id);
    if (others.length) throw new Error("You own a workspace that has other members. Delete that workspace or remove the members first.");
  }
  for (const m of ms.docs) { if (m.data().role === "owner") await deleteWorkspaceCascade(m.data().workspace_id); else await deleteDoc(m.ref); }
  const prof = await getDoc(doc(fs, "users", u.uid));
  if (prof.data()?.username) await deleteDoc(doc(fs, "usernames", prof.data()!.username));
  await deleteDoc(doc(fs, "emails", (u.email ?? "").toLowerCase())); await deleteDoc(doc(fs, "users", u.uid)); await deleteUser(u);
}
async function storageUsage(): Promise<number> {
  // Rules allow listing only inside a workspace folder, so sum the folders of workspaces I manage.
  const u = me(); if (!u) return 0; let total = 0;
  const walk = async (r: ReturnType<typeof ref>) => { const l = await listAll(r); for (const i of l.items) total += (await getMetadata(i)).size; for (const p of l.prefixes) await walk(p); };
  const ms = await getDocs(query(collection(fs, "members"), where("user_id", "==", u)));
  for (const m of ms.docs) if (["owner", "admin"].includes(m.data().role)) await walk(ref(storage, m.data().workspace_id));
  return total;
}

async function rpc(name: string, a: Row = {}): Promise<Res> {
  try {
    switch (name) {
      case "create_workspace": return { data: await createWorkspace(a.p_name, a.p_org), error: null };
      case "add_member": {
        const s = await getDoc(doc(fs, "emails", String(a.p_email).trim().toLowerCase()));
        if (!s.exists()) throw new Error("No user with that email. Ask them to sign up first.");
        await setDoc(doc(fs, "members", `${a.p_ws}_${s.data().uid}`), { workspace_id: a.p_ws, user_id: s.data().uid, role: a.p_role, created_at: nowIso() }, { merge: true });
        const d = await getDoc(doc(fs, "members", `${a.p_ws}_${s.data().uid}`)); if (d.data()!.see_all === undefined) await updateDoc(d.ref, { see_all: false, can_download: false });
        memCache.clear(); return { data: null, error: null };
      }
      case "ensure_workspace_thread": return { data: await ensureWorkspaceThread(a.p_ws), error: null };
      case "list_chat_threads": {
        await ensureWorkspaceThread(a.p_ws);
        const ws = await getDoc(doc(fs, "chat_threads", `ws_${a.p_ws}`));
        const mine = await getDocs(query(collection(fs, "chat_threads"), where("member_ids", "array-contains", me())));
        return { data: [ws.data(), ...mine.docs.map((d) => d.data())].filter(Boolean), error: null };
      }
      case "start_private_chat": {
        const other = await uidByUsername(a.p_username); const u = me()!; if (other === u) throw new Error("That is you");
        return { data: await makeThread(`dm_${[u, other].sort().join("_")}`, "private", null, [u, other]), error: null };
      }
      case "create_group": {
        const ids = [me()!, ...(await Promise.all((a.p_usernames as string[]).map(uidByUsername)))];
        return { data: await makeThread(`grp_${uuid()}`, "group", a.p_title, [...new Set(ids)]), error: null };
      }
      case "create_sample_workspace": return { data: await createSample(), error: null };
      case "remove_sample_data": await removeSample(); return { data: null, error: null };
      case "delete_account": await deleteAccount(); return { data: null, error: null };
      case "storage_usage_total": return { data: await storageUsage(), error: null };
    }
    throw new Error(`Unknown function ${name}`);
  } catch (e) { console.error(`rpc ${name} failed:`, (e as Error).message); return { data: null, error: fail(e) }; }
}

// ---------- auth ----------
const toSession = (u: User | null) => (u ? { user: { id: u.uid, email: u.email } } : null);
const authReady = new Promise<void>((res) => { const off = onAuthStateChanged(auth, () => { off(); res(); }); });
async function ensureUserDoc(u: User, fullName?: string) {
  const r = doc(fs, "users", u.uid); const s = await getDoc(r); const email = (u.email ?? "").toLowerCase();
  if (!s.exists()) await setDoc(r, { id: u.uid, email, full_name: fullName || email.split("@")[0], username: null, advanced: false, created_at: nowIso() });
  await setDoc(doc(fs, "emails", email), { uid: u.uid }, { merge: true });
}
const dbAuth = {
  async getSession() { await authReady; return { data: { session: toSession(auth.currentUser) } }; },
  onAuthStateChange(cb: (event: string, session: ReturnType<typeof toSession>) => void) {
    const off = onAuthStateChanged(auth, (u) => cb(u ? "SIGNED_IN" : "SIGNED_OUT", toSession(u)));
    return { data: { subscription: { unsubscribe: off } } };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try { const c = await signInWithEmailAndPassword(auth, email, password); await ensureUserDoc(c.user); return { data: { session: toSession(c.user) }, error: null as Err }; }
    catch (e) { return { data: { session: null }, error: fail(e) }; }
  },
  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: { full_name?: string } } }) {
    try { const c = await createUserWithEmailAndPassword(auth, email, password); await ensureUserDoc(c.user, options?.data?.full_name); return { data: { session: toSession(c.user) }, error: null as Err }; }
    catch (e) { return { data: { session: null }, error: fail(e) }; }
  },
  async signInWithOtp({ email, options }: { email: string; options?: { emailRedirectTo?: string } }) {
    try {
      await sendSignInLinkToEmail(auth, email, { url: options?.emailRedirectTo ?? `${location.origin}/login`, handleCodeInApp: true });
      try { localStorage.setItem("ef_link_email", email); } catch { /* ignore */ }
      return { error: null as Err };
    } catch (e) { return { error: fail(e) }; }
  },
  /** Call on the login page: finishes a magic-link sign-in if the URL is one. */
  async completeEmailLink() {
    if (!isSignInWithEmailLink(auth, location.href)) return { signedIn: false, error: null as Err };
    let email = ""; try { email = localStorage.getItem("ef_link_email") || ""; } catch { /* ignore */ }
    email = email || prompt("Confirm your email to finish signing in") || "";
    try { const c = await signInWithEmailLink(auth, email, location.href); await ensureUserDoc(c.user); return { signedIn: true, error: null as Err }; }
    catch (e) { return { signedIn: false, error: fail(e) }; }
  },
  async updateUser({ password }: { password: string }) {
    try { await updatePassword(auth.currentUser!, password); return { error: null as Err }; } catch (e) { return { error: fail(e) }; }
  },
  async reauth(password: string) { const u = auth.currentUser!; await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email!, password)); },
  async signOut() { await fbSignOut(auth); return { error: null as Err }; },
};

// ---------- storage ----------
const bucket = (name: string) => { void name; return {
  async upload(path: string, file: Blob, opts?: { contentType?: string }) {
    try { await uploadBytes(ref(storage, path), file, { contentType: opts?.contentType ?? (file as File).type }); return { data: { path }, error: null as Err }; } catch (e) { return { data: null, error: fail(e) }; }
  },
  async createSignedUrl(path: string, ttl?: number) { void ttl;
    try { return { data: { signedUrl: await getDownloadURL(ref(storage, path)) }, error: null as Err }; } catch (e) { return { data: null, error: fail(e) }; }
  },
  async download(path: string) { try { return { data: await getBlob(ref(storage, path)), error: null as Err }; } catch (e) { return { data: null, error: fail(e) }; } },
  async remove(paths: string[]) {
    try { await Promise.all(paths.map((p) => deleteObject(ref(storage, p)).catch((e) => { if ((e as { code?: string }).code !== "storage/object-not-found") throw e; }))); return { data: null, error: null as Err }; }
    catch (e) { return { data: null, error: fail(e) }; }
  },
}; };

// ---------- realtime (per-collection listener with an equality filter) ----------
type Chan = { on: (kind: string, cfg: { event: string; schema?: string; table: string; filter?: string }, cb: (p: { new: Row }) => void) => Chan; subscribe: () => Chan; _off: (() => void)[]; _subs: (() => void)[] };
function channel(name: string): Chan {
  void name;
  const c: Chan = {
    _off: [], _subs: [],
    on(_k, cfg, cb) {
      c._subs.push(() => {
        const m = cfg.filter?.match(/^(\w+)=eq\.(.*)$/); if (!m) return;
        let first = true;
        const off = onSnapshot(query(collection(fs, colName(cfg.table)), where(m[1], "==", m[2])), (snap) => {
          if (first) { first = false; return; }
          snap.docChanges().filter((d) => d.type === "added").forEach((d) => cb({ new: d.doc.data() }));
        }, () => {});
        c._off.push(off);
      });
      return c;
    },
    subscribe() { c._subs.forEach((s) => s()); return c; },
  };
  return c;
}

export const db = {
  from: (table: string) => new Q(table),
  rpc,
  auth: dbAuth,
  storage: { from: bucket },
  channel,
  removeChannel: (c: Chan) => { c._off.forEach((f) => f()); },
};
export type { DocumentReference };
