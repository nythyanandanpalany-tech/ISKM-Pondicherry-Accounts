// Run with the emulators up:  npm run test:rules
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-expenseflow",
  firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firebase/firestore.rules", "utf8") },
});
let pass = 0, fail = 0;
const t = async (name, p) => { try { await p(); pass++; console.log("  ok  ", name); } catch (e) { fail++; console.log("  FAIL", name, "-", String(e.message).split("\n")[0].slice(0, 110)); } };
const W = "w1", OWNER = "owner", ED = "editor", ED2 = "editor2", VIEW = "viewer", OUT = "outsider";
const now = new Date().toISOString();
const mem = (u, role, extra = {}) => ({ workspace_id: W, user_id: u, role, see_all: false, can_download: false, created_at: now, ...extra });
const entry = (id, by, extra = {}) => ({ id, workspace_id: W, type: "expense", amount: 100, created_by: by, claim_status: null, entry_date: "2026-11-01", ...extra });

await env.clearFirestore();
await env.withSecurityRulesDisabled(async (c) => {
  const f = c.firestore();
  await setDoc(doc(f, "workspaces", W), { id: W, name: "T", created_by: OWNER });
  for (const [u, r, x] of [[OWNER, "owner", { see_all: true }], [ED, "editor"], [ED2, "editor"], [VIEW, "viewer"]]) await setDoc(doc(f, "members", `${W}_${u}`), mem(u, r, x || {}));
  await setDoc(doc(f, "entries", "e_owner"), entry("e_owner", OWNER));
  await setDoc(doc(f, "entries", "e_ed"), entry("e_ed", ED));
  await setDoc(doc(f, "entries", "e_ed_claim"), entry("e_ed_claim", ED, { claim_status: "approved" }));
  await setDoc(doc(f, "bank_transactions", "b1"), { id: "b1", workspace_id: W, amount: 5 });
  await setDoc(doc(f, "store_items", "si1"), { id: "si1", workspace_id: W, store_id: "s1", name: "Rice", qty: 30 });
  await setDoc(doc(f, "chat_threads", `ws_${W}`), { id: `ws_${W}`, kind: "workspace", workspace_id: W, member_ids: [] });
  await setDoc(doc(f, "chat_threads", "dm1"), { id: "dm1", kind: "private", workspace_id: null, member_ids: [OWNER, ED] });
  await setDoc(doc(f, "chat_messages", "m1"), { thread_id: "dm1", sender_id: OWNER, body: "hi", created_at: now });
  await setDoc(doc(f, "chat_messages", "m2"), { thread_id: `ws_${W}`, sender_id: OWNER, body: "hello all", created_at: now });
});
const as = (u) => env.authenticatedContext(u).firestore();
const anon = () => env.unauthenticatedContext().firestore();

console.log("Entries");
await t("owner reads every entry", () => assertSucceeds(getDocs(query(collection(as(OWNER), "entries"), where("workspace_id", "==", W)))));
await t("editor lists only own entries (query with created_by)", () => assertSucceeds(getDocs(query(collection(as(ED), "entries"), where("workspace_id", "==", W), where("created_by", "==", ED)))));
await t("editor cannot list the whole workspace", () => assertFails(getDocs(query(collection(as(ED), "entries"), where("workspace_id", "==", W)))));
await t("editor cannot read owner's entry", () => assertFails(getDoc(doc(as(ED), "entries", "e_owner"))));
await t("outsider cannot read entries", () => assertFails(getDocs(query(collection(as(OUT), "entries"), where("workspace_id", "==", W)))));
await t("signed-out user cannot read", () => assertFails(getDoc(doc(anon(), "entries", "e_ed"))));
await t("editor adds own entry", () => assertSucceeds(setDoc(doc(as(ED), "entries", "n1"), entry("n1", ED))));
await t("editor cannot add entry as someone else", () => assertFails(setDoc(doc(as(ED), "entries", "n2"), entry("n2", OWNER))));
await t("editor cannot add an already-approved claim", () => assertFails(setDoc(doc(as(ED), "entries", "n3"), entry("n3", ED, { claim_status: "approved" }))));
await t("viewer cannot add entries", () => assertFails(setDoc(doc(as(VIEW), "entries", "n4"), entry("n4", VIEW))));
await t("outsider cannot add entries", () => assertFails(setDoc(doc(as(OUT), "entries", "n5"), entry("n5", OUT))));
await t("negative amount rejected", () => assertFails(setDoc(doc(as(OWNER), "entries", "n6"), entry("n6", OWNER, { amount: -5 }))));
await t("editor edits own pending entry", () => assertSucceeds(updateDoc(doc(as(ED), "entries", "e_ed"), { amount: 150 })));
await t("editor cannot edit own entry once approved", () => assertFails(updateDoc(doc(as(ED), "entries", "e_ed_claim"), { amount: 1 })));
await t("editor cannot approve own claim", () => assertFails(updateDoc(doc(as(ED), "entries", "e_ed"), { claim_status: "approved" })));
await t("editor cannot edit someone else's entry", () => assertFails(updateDoc(doc(as(ED2), "entries", "e_ed"), { amount: 1 })));
await t("owner approves a claim", () => assertSucceeds(updateDoc(doc(as(OWNER), "entries", "e_ed"), { claim_status: "approved" })));
await t("editor can delete own pending entry", () => assertSucceeds(deleteDoc(doc(as(ED), "entries", "n1"))));
await t("viewer cannot delete", () => assertFails(deleteDoc(doc(as(VIEW), "entries", "e_owner"))));

console.log("Membership & workspaces");
await t("outsider cannot read workspace", () => assertFails(getDoc(doc(as(OUT), "workspaces", W))));
await t("member reads workspace", () => assertSucceeds(getDoc(doc(as(ED), "workspaces", W))));
await t("editor cannot rename workspace", () => assertFails(updateDoc(doc(as(ED), "workspaces", W), { name: "x" })));
await t("owner renames workspace", () => assertSucceeds(updateDoc(doc(as(OWNER), "workspaces", W), { name: "Renamed" })));
await t("outsider cannot add themselves as owner", () => assertFails(setDoc(doc(as(OUT), "members", `${W}_${OUT}`), mem(OUT, "owner"))));
await t("outsider cannot add themselves as editor", () => assertFails(setDoc(doc(as(OUT), "members", `${W}_${OUT}`), mem(OUT, "editor"))));
await t("editor cannot add members", () => assertFails(setDoc(doc(as(ED), "members", `${W}_new`), mem("new", "viewer"))));
await t("owner adds a member", () => assertSucceeds(setDoc(doc(as(OWNER), "members", `${W}_new`), mem("new", "viewer"))));
await t("owner cannot mint a second owner", () => assertFails(setDoc(doc(as(OWNER), "members", `${W}_x2`), mem("x2", "owner"))));
await t("editor cannot promote self to admin", () => assertFails(updateDoc(doc(as(ED), "members", `${W}_${ED}`), { role: "admin" })));
await t("new user creates workspace + owner membership in one batch", async () => {
  const f = as("founder"); const b = writeBatch(f); const w = "w_new";
  b.set(doc(f, "workspaces", w), { id: w, name: "N", created_by: "founder" });
  b.set(doc(f, "members", `${w}_founder`), { workspace_id: w, user_id: "founder", role: "owner", see_all: true, can_download: true, created_at: now });
  await assertSucceeds(b.commit());
});
await t("cannot grab ownership of an existing workspace via batch", async () => {
  const f = as(OUT); const b = writeBatch(f);
  b.set(doc(f, "workspaces", W), { id: W, name: "hijack", created_by: OUT });
  b.set(doc(f, "members", `${W}_${OUT}`), mem(OUT, "owner"));
  await assertFails(b.commit());
});

console.log("Bank, store, chats");
await t("owner reads bank rows", () => assertSucceeds(getDocs(query(collection(as(OWNER), "bank_transactions"), where("workspace_id", "==", W)))));
await t("editor cannot read bank rows", () => assertFails(getDocs(query(collection(as(ED), "bank_transactions"), where("workspace_id", "==", W)))));
await t("editor stock-out with matching count (30 -> 25)", async () => {
  const f = as(ED); const b = writeBatch(f);
  b.update(doc(f, "store_items", "si1"), { qty: 25 });
  b.set(doc(f, "stock_moves", "mv1"), { id: "mv1", workspace_id: W, store_item_id: "si1", direction: "out", qty: 5, created_by: ED });
  await assertSucceeds(b.commit());
});
await t("stock move that overdraws is rejected", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "store_items", "si1"), { id: "si1", workspace_id: W, store_id: "s1", name: "Rice", qty: 3 }));
  const f = as(ED); const b = writeBatch(f);
  b.update(doc(f, "store_items", "si1"), { qty: -2 });
  b.set(doc(f, "stock_moves", "mv2"), { id: "mv2", workspace_id: W, store_item_id: "si1", direction: "out", qty: 5, created_by: ED });
  await assertFails(b.commit());
});
await t("stock move with a mismatched count is rejected", async () => {
  const f = as(ED); const b = writeBatch(f);
  b.update(doc(f, "store_items", "si1"), { qty: 100 });
  b.set(doc(f, "stock_moves", "mv3"), { id: "mv3", workspace_id: W, store_item_id: "si1", direction: "out", qty: 1, created_by: ED });
  await assertFails(b.commit());
});
await t("editor cannot create a store", () => assertFails(setDoc(doc(as(ED), "stores", "st9"), { id: "st9", workspace_id: W, name: "x" })));
await t("viewer cannot change stock", () => assertFails(updateDoc(doc(as(VIEW), "store_items", "si1"), { qty: 99 })));
await t("workspace member reads workspace chat", () => assertSucceeds(getDocs(query(collection(as(VIEW), "chat_messages"), where("thread_id", "==", `ws_${W}`)))));
await t("outsider cannot read workspace chat", () => assertFails(getDocs(query(collection(as(OUT), "chat_messages"), where("thread_id", "==", `ws_${W}`)))));
await t("private chat: participant reads", () => assertSucceeds(getDocs(query(collection(as(ED), "chat_messages"), where("thread_id", "==", "dm1")))));
await t("private chat: non-participant blocked", () => assertFails(getDocs(query(collection(as(ED2), "chat_messages"), where("thread_id", "==", "dm1")))));
await t("participant posts", () => assertSucceeds(setDoc(doc(as(ED), "chat_messages", "m9"), { thread_id: "dm1", sender_id: ED, body: "yes", created_at: now })));
await t("cannot post as another sender", () => assertFails(setDoc(doc(as(ED), "chat_messages", "m10"), { thread_id: "dm1", sender_id: OWNER, body: "spoof", created_at: now })));
await t("non-participant cannot post", () => assertFails(setDoc(doc(as(OUT), "chat_messages", "m11"), { thread_id: "dm1", sender_id: OUT, body: "x", created_at: now })));
await t("messages cannot be edited", () => assertFails(updateDoc(doc(as(OWNER), "chat_messages", "m1"), { body: "changed" })));
await t("messages cannot be deleted", () => assertFails(deleteDoc(doc(as(OWNER), "chat_messages", "m1"))));
await t("user lists own threads (array-contains)", () => assertSucceeds(getDocs(query(collection(as(ED), "chat_threads"), where("member_ids", "array-contains", ED)))));
await t("reading a not-yet-created thread is a clean miss, not an error", async () => { const r = await getDoc(doc(as(OWNER), "chat_threads", "ws_none")); if (r.exists()) throw new Error("exists?"); });
await t("reading a missing membership doc is a clean miss", async () => { const r = await getDoc(doc(as(OUT), "members", "w1_outsider")); if (r.exists()) throw new Error("exists?"); });
await t("user cannot list user directory", () => assertFails(getDocs(collection(as(ED), "users"))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
