// Table reads and writes go through a wrapper that turns Postgres's own words into plain language
// (see `softened` in lib/db.ts). This pins two things: a refusal reads the way a sevak can act on,
// and the wrapper does not get in the way of anything that worked before — chaining, awaiting,
// Promise.all, .single().
import { test } from "node:test";
import assert from "node:assert/strict";

let reply = { status: 200, body: [] };
globalThis.fetch = async () => new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "k";
const { db } = await import("../db.ts");

test("a delete the database refuses because something still uses the row says so plainly", async () => {
  reply = { status: 409, body: { code: "23503", message: 'update or delete on table "entries" violates foreign key constraint "entries_settles_entry_id_fkey" on table "entries"' } };
  const { error } = await db.from("entries").delete().eq("id", "x");
  assert.match(error.message, /still used by existing entries or journal vouchers/);
  assert.doesNotMatch(error.message, /violates foreign key/);
});

test("other refusals are translated too", async () => {
  reply = { status: 403, body: { code: "42501", message: 'new row violates row-level security policy for table "entries"' } };
  assert.match((await db.from("entries").insert({ a: 1 })).error.message, /Not allowed/);
  reply = { status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint" } };
  assert.match((await db.from("bank_accounts").insert({ name: "x" })).error.message, /already exists/);
});

test("a message that is already plain is left alone", async () => {
  reply = { status: 400, body: { code: "P0001", message: "That is more than is still unpaid on this bill (400 of 1000 already paid)" } };
  assert.equal((await db.from("entries").insert({ a: 1 })).error.message, "That is more than is still unpaid on this bill (400 of 1000 already paid)");
});

test("a successful read comes back untouched, however it is chained", async () => {
  reply = { status: 200, body: [{ id: "1" }, { id: "2" }] };
  const r = await db.from("entries").select("*").eq("workspace_id", "w").order("id").limit(5);
  assert.equal(r.error, null);
  assert.deepEqual(r.data.map((x) => x.id), ["1", "2"]);
  const [a, b] = await Promise.all([db.from("entries").select("*"), db.from("people").select("*").eq("x", 1)]);
  assert.equal(a.data.length + b.data.length, 4);
  reply = { status: 200, body: { id: "1" } };
  assert.equal((await db.from("profiles").select("*").eq("id", "1").single()).data.id, "1");
});
