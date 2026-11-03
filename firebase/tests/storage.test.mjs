// Run with the emulators up:  npm run test:rules
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getBytes, deleteObject } from "firebase/storage";

const env = await initializeTestEnvironment({
  projectId: "demo-expenseflow",
  firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firebase/firestore.rules", "utf8") },
  storage: { host: "127.0.0.1", port: 9199, rules: readFileSync("firebase/storage.rules", "utf8") },
});
let pass = 0, fail = 0;
const t = async (name, p) => { try { await p(); pass++; console.log("  ok  ", name); } catch (e) { fail++; console.log("  FAIL", name, "-", String(e.message).split("\n")[0].slice(0, 120)); } };
const W = "w1", now = new Date().toISOString();
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (c) => {
  for (const [u, r] of [["owner", "owner"], ["editor", "editor"], ["viewer", "viewer"]]) await setDoc(doc(c.firestore(), "members", `${W}_${u}`), { workspace_id: W, user_id: u, role: r, created_at: now });
});
const st = (u) => env.authenticatedContext(u).storage();
const png = () => new Uint8Array(1000);
console.log("Storage rules (photos)");
await t("editor uploads a PNG to the workspace folder", () => assertSucceeds(uploadBytes(ref(st("editor"), `${W}/a.png`), png(), { contentType: "image/png" })));
await t("owner uploads a PDF", () => assertSucceeds(uploadBytes(ref(st("owner"), `${W}/b.pdf`), png(), { contentType: "application/pdf" })));
await t("member reads a photo", () => assertSucceeds(getBytes(ref(st("viewer"), `${W}/a.png`))));
await t("outsider cannot read a photo", () => assertFails(getBytes(ref(st("outsider"), `${W}/a.png`))));
await t("signed-out user cannot read", () => assertFails(getBytes(ref(env.unauthenticatedContext().storage(), `${W}/a.png`))));
await t("viewer cannot upload", () => assertFails(uploadBytes(ref(st("viewer"), `${W}/c.png`), png(), { contentType: "image/png" })));
await t("outsider cannot upload", () => assertFails(uploadBytes(ref(st("outsider"), `${W}/c.png`), png(), { contentType: "image/png" })));
await t("cannot upload into another workspace's folder", () => assertFails(uploadBytes(ref(st("editor"), `other/c.png`), png(), { contentType: "image/png" })));
await t("non-image / non-PDF file rejected", () => assertFails(uploadBytes(ref(st("editor"), `${W}/x.exe`), png(), { contentType: "application/octet-stream" })));
await t("file over 3 MB rejected", () => assertFails(uploadBytes(ref(st("editor"), `${W}/big.png`), new Uint8Array(3 * 1024 * 1024 + 10), { contentType: "image/png" })));
await t("editor can delete a photo", () => assertSucceeds(deleteObject(ref(st("editor"), `${W}/a.png`))));
await t("viewer cannot delete a photo", () => assertFails(deleteObject(ref(st("viewer"), `${W}/b.pdf`))));
console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
