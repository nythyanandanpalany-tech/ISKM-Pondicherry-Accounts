// End to end: users and roles (change 3D). A super admin who belongs to no workspace sees every user and
// workspace, hands out roles, full view and super admin itself; a main accountant keeps the books but cannot
// edit; an entry user adds and sees only their own. Every check of what was stored reads the database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, newSession, login, openLedger, newEntry, rowFor, reseed, sql, shot, BASE } from "./helpers.mjs";
import { USERS, WS, WS_NAME, CAT } from "./fixtures.mjs";

let browser, sa, page;
const radio = (scope, text) => scope.locator("label").filter({ hasText: new RegExp(`^${text}$`) });
const roleOf = (u) => sql(`select coalesce((select role || ' ' || see_all || ' ' || can_download from members where workspace_id = '${WS}' and user_id = '${u.id}'), 'none')`);
const isSuper = (u) => sql(`select super_admin from profiles where id = '${u.id}'`);
/** A saved change shows a message that lingers for a few seconds, so wait on the database itself instead. */
async function eventually(read, want, ms = 10000) {
  const t0 = Date.now(); let got;
  while ((got = read()) !== want) {
    if (Date.now() - t0 > ms) assert.equal(got, want);
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  reseed();
  // One voucher by the owner, so "sees only own" and "full view" have something to show or hide.
  sql(`insert into entries (workspace_id, type, entry_date, amount, category_id, payment_mode, note, created_by)
       values ('${WS}', 'expense', '2026-11-12', 500, '${CAT.annadanam}', 'Cash', 'owner-cv', '${USERS.owner.id}')`);
  browser = await launch();
  sa = await newSession(browser); page = sa.page;
  await login(page, USERS.superAdmin);
});
after(async () => { await sa?.close(); await browser?.close(); });

const ownerVoucher = () => sql("select voucher_no from entries where note = 'owner-cv'");

async function openAdmin(p = page, tab = "Users") {
  await p.goto(`${BASE}/app/admin`);
  await p.getByRole("heading", { name: "Users & permissions" }).waitFor();
  await p.getByRole("tab", { name: tab }).click();
}
async function manage(u) {
  await openAdmin(page, "Users");
  await page.getByRole("button", { name: `Manage ${u.email}` }).click();
  await page.getByRole("region", { name: "Full permissions" }).getByText(u.email).waitFor();
}
const status = async () => { const s = page.getByRole("status"); await s.waitFor(); return (await s.textContent()).trim(); };

test("a super admin who is in no workspace still sees it, with every book, and is called Super admin", async () => {
  assert.equal(sql(`select count(*) from members where user_id = '${USERS.superAdmin.id}'`), "0");
  for (const name of ["Users & permissions", "Accounts", "Weekly settlement", "Bank Statement", "Reconcile"]) {
    await page.getByRole("link", { name, exact: true }).first().waitFor();
  }
  await page.locator("aside").getByRole("button", { name: /Sundar Super/ }).click();
  assert.equal((await page.locator("aside").getByTestId("my-role").textContent()).trim(), "Super admin");
  await page.keyboard.press("Escape");
  await openLedger(page);
  await rowFor(page, ownerVoucher()).waitFor();
});

test("the Users tab lists every account from the database, with each one's access", async () => {
  await openAdmin(page, "Users");
  const total = Number(sql("select count(*) from profiles"));
  await page.getByRole("heading", { name: new RegExp(`All users \\(${total}\\)`) }).waitFor();
  for (const u of Object.values(USERS)) await page.getByTestId(`user-${u.email}`).waitFor();
  assert.match(await page.getByTestId(`user-${USERS.superAdmin.email}`).textContent(), /Super admin/);
  assert.match(await page.getByTestId(`user-${USERS.accountant.email}`).textContent(), new RegExp(`${WS_NAME} · Main accountant`));
  assert.match(await page.getByTestId(`user-${USERS.editor.email}`).textContent(), new RegExp(`${WS_NAME} · Entry user`));
  assert.match(await page.getByTestId(`user-${USERS.newcomer.email}`).textContent(), /No workspace yet/);
  await page.getByLabel("Search users").fill("anand");
  await page.getByTestId(`user-${USERS.editor.email}`).waitFor({ state: "detached" });
  await page.getByTestId(`user-${USERS.accountant.email}`).waitFor();
  await shot(page, "admin-users");
});

test("the super admin gives a newcomer a role, and it is stored and logged", async () => {
  await manage(USERS.newcomer);
  const row = page.getByTestId(`perm-${WS_NAME}`);
  await row.getByLabel(`Role in ${WS_NAME}`).selectOption({ label: "Entry user" });
  assert.match(await status(), /Saved Nila Newcomer/);
  await eventually(() => roleOf(USERS.newcomer), "editor false false");
  assert.equal(sql(`select change || ' by ' || by_user from role_log where user_id = '${USERS.newcomer.id}'`), `added as editor by ${USERS.superAdmin.id}`);
  await page.getByRole("region", { name: "Recent permission changes" }).getByText(/Nila Newcomer in E2E Temple: added as Entry user/).waitFor();
  await shot(page, "admin-permissions");
});

test("an entry user sees only their own entries, and cannot edit or delete even those", async () => {
  const n = await newSession(browser);
  try {
    await login(n.page, USERS.newcomer);
    await n.page.locator("aside").getByRole("button", { name: /Nila Newcomer/ }).click();
    assert.equal((await n.page.locator("aside").getByTestId("my-role").textContent()).trim(), "Entry user");
    await n.page.keyboard.press("Escape");
    for (const name of ["Accounts", "Weekly settlement", "Bank Statement", "Users & permissions"]) {
      assert.equal(await n.page.getByRole("link", { name, exact: true }).count(), 0, `${name} should be hidden`);
    }
    await openLedger(n.page);
    await newEntry(n.page, { amount: 75, date: "2026-11-13", category: "Festival", note: "newcomer-cv" });
    const mine = sql("select voucher_no from entries where note = 'newcomer-cv'");
    assert.match(mine, /^2026-2027\/CV\/11\/V\d{3}$/);
    await rowFor(n.page, mine).waitFor();
    assert.equal(await rowFor(n.page, ownerVoucher()).count(), 0, "the owner's entry must be hidden");

    await rowFor(n.page, mine).click();
    const dlg = n.page.getByRole("dialog");
    await dlg.getByText(mine).waitFor();
    assert.equal(await dlg.getByRole("button", { name: "Edit" }).count(), 0);
    assert.equal(await dlg.getByRole("button", { name: "Delete" }).count(), 0);
    await n.page.keyboard.press("Escape");

    // Going round the screen does not help: the database itself refuses the change.
    const id = sql("select id from entries where note = 'newcomer-cv'");
    const res = await n.page.evaluate(async ({ id }) => {
      const raw = Object.keys(localStorage).find((k) => k.includes("auth-token"));
      const token = JSON.parse(localStorage.getItem(raw)).access_token;
      const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: "x", Prefer: "return=representation" };
      const up = await fetch(`http://127.0.0.1:54321/rest/v1/entries?id=eq.${id}`, { method: "PATCH", headers: h, body: JSON.stringify({ amount: 1 }) });
      const del = await fetch(`http://127.0.0.1:54321/rest/v1/entries?id=eq.${id}`, { method: "DELETE", headers: h });
      return { up: await up.json(), del: await del.json() };
    }, { id });
    assert.deepEqual(res, { up: [], del: [] });
    assert.equal(sql("select amount from entries where note = 'newcomer-cv'"), "75.00");
    n.clean();
  } finally { await n.close(); }
});

test("full view, switched on by the super admin, shows an entry user the whole workspace — and off again hides it", async () => {
  await manage(USERS.newcomer);
  const row = page.getByTestId(`perm-${WS_NAME}`);
  await row.getByLabel(`Full view in ${WS_NAME}`).click();
  assert.match(await status(), /Saved/);
  await eventually(() => roleOf(USERS.newcomer), "editor true false");

  const n = await newSession(browser);
  try {
    await login(n.page, USERS.newcomer);
    await openLedger(n.page);
    await rowFor(n.page, ownerVoucher()).waitFor();
    await rowFor(n.page, ownerVoucher()).click();
    await n.page.getByRole("dialog").getByText(ownerVoucher()).waitFor();
    assert.equal(await n.page.getByRole("dialog").getByRole("button", { name: "Edit" }).count(), 0, "full view is not edit");
    await n.page.keyboard.press("Escape");

    await page.getByTestId(`perm-${WS_NAME}`).getByLabel(`Full view in ${WS_NAME}`).click();
    await status();
    await eventually(() => roleOf(USERS.newcomer), "editor false false");
    await openLedger(n.page);
    await rowFor(n.page, sql("select voucher_no from entries where note = 'newcomer-cv'")).waitFor();
    assert.equal(await rowFor(n.page, ownerVoucher()).count(), 0);
    n.clean();
  } finally { await n.close(); }
});

test("a main accountant sees everything, keeps the books and may journal, but cannot edit", async () => {
  const a = await newSession(browser);
  try {
    await login(a.page, USERS.accountant);
    await a.page.locator("aside").getByRole("button", { name: /Anand Accountant/ }).click();
    assert.equal((await a.page.locator("aside").getByTestId("my-role").textContent()).trim(), "Main accountant");
    await a.page.keyboard.press("Escape");
    for (const name of ["Accounts", "Weekly settlement", "Bank Statement", "Reconcile"]) await a.page.getByRole("link", { name, exact: true }).first().waitFor();
    assert.equal(await a.page.getByRole("link", { name: "Users & permissions" }).count(), 0);

    await openLedger(a.page);
    await rowFor(a.page, ownerVoucher()).waitFor();            // without full view
    await rowFor(a.page, ownerVoucher()).click();
    const dlg = a.page.getByRole("dialog");
    await dlg.getByText(/Not yet matched to a bank transaction|Matched to bank transaction/).waitFor();
    assert.equal(await dlg.getByRole("button", { name: "Edit" }).count(), 0);
    assert.equal(await dlg.getByRole("button", { name: "Delete" }).count(), 0);
    await a.page.keyboard.press("Escape");

    await a.page.getByRole("button", { name: "+ Add entry" }).first().click();
    await radio(a.page.getByRole("dialog"), "Journal").click();
    const jv = a.page.getByRole("dialog");
    await jv.getByRole("heading", { name: "New journal voucher" }).waitFor();
    await radio(jv, "Move an amount between heads").click();
    await jv.getByLabel(/^Amount/).fill("120");
    await jv.getByLabel(/^Date/).fill("2026-11-14");
    await jv.getByLabel(/^Debit/).selectOption({ label: "Festival" });
    await jv.getByLabel(/^Credit/).selectOption({ label: "Annadanam" });
    await jv.getByLabel(/^Narration/).fill("accountant-jv");
    await jv.getByRole("button", { name: "Add journal voucher" }).click();
    await a.page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(sql("select voucher_no || ' ' || created_by from entries where note = 'accountant-jv'"), `2026-2027/JV/11/V001 ${USERS.accountant.id}`);

    await a.page.goto(`${BASE}/app/accounts`);
    await a.page.getByRole("button", { name: "Reports" }).waitFor();
    assert.equal(await a.page.getByRole("button", { name: "Setup" }).count(), 0, "setup stays with owners and admins");
    await a.page.goto(`${BASE}/app/settlement`);
    await a.page.getByRole("heading", { name: "Weekly settlement" }).waitFor();
    await a.page.goto(`${BASE}/app/admin`);
    await a.page.getByText("Only a super admin can open Users & permissions.").waitFor();
    a.clean();
  } finally { await a.close(); }
});

test("a workspace owner can add a main accountant, but cannot reach the super admin's screen", async () => {
  const o = await newSession(browser);
  try {
    await login(o.page, USERS.owner);
    assert.equal(await o.page.getByRole("link", { name: "Users & permissions" }).count(), 0);
    await o.page.goto(`${BASE}/app/admin`);
    await o.page.getByText("Only a super admin can open Users & permissions.").waitFor();
    const refused = await o.page.evaluate(async () => {
      const raw = Object.keys(localStorage).find((k) => k.includes("auth-token"));
      const token = JSON.parse(localStorage.getItem(raw)).access_token;
      const r = await fetch("http://127.0.0.1:54321/rest/v1/rpc/admin_list_users", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: "x" }, body: "{}" });
      return r.status;
    });
    assert.ok(refused >= 400, `admin_list_users should be refused, got ${refused}`);
    o.expectRefusals(1);

    await o.page.goto(`${BASE}/app/settings`);
    const roleSelect = o.page.getByLabel(`Role of ${USERS.newcomer.name}`);
    await roleSelect.selectOption({ label: "Main accountant" });
    await o.page.getByRole("status").waitFor();
    await eventually(() => roleOf(USERS.newcomer), "accountant false false");
    await roleSelect.selectOption({ label: "Entry user" });
    await o.page.getByRole("status").waitFor();
    await eventually(() => roleOf(USERS.newcomer), "editor false false");
    o.clean();
  } finally { await o.close(); }
});

test("the super admin may edit and delete any entry, in a workspace they were never added to", async () => {
  await openLedger(page);
  const no = sql("select voucher_no from entries where note = 'newcomer-cv'");
  await rowFor(page, no).click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Edit entry" }).waitFor();
  await dlg.getByLabel(/^Amount/).fill("80");
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(sql("select amount from entries where note = 'newcomer-cv'"), "80.00");

  await rowFor(page, no).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this entry" }).getByRole("button", { name: "Delete", exact: true }).click();
  await rowFor(page, no).waitFor({ state: "detached" });
  assert.equal(sql("select count(*) from entries where note = 'newcomer-cv'"), "0");
  assert.equal(sql(`select by_user from entry_log where action = 'deleted' and snapshot->>'note' = 'newcomer-cv'`), USERS.superAdmin.id);
});

test("the super admin can give admin access to anyone, and take it back", async () => {
  await manage(USERS.newcomer);
  await page.getByRole("region", { name: "Full permissions" }).getByLabel(/Super admin/).click();
  await page.getByRole("dialog", { name: "Make super admin" }).getByRole("button", { name: "Make super admin" }).click();
  assert.match(await status(), /now a super admin/);
  await eventually(() => isSuper(USERS.newcomer), "t");

  const n = await newSession(browser);
  try {
    await login(n.page, USERS.newcomer);
    await openAdmin(n.page, "Users");
    await n.page.getByTestId(`user-${USERS.owner.email}`).waitFor();
    n.clean();
  } finally { await n.close(); }

  await page.getByRole("region", { name: "Full permissions" }).getByLabel(/Super admin/).click();
  await page.getByRole("dialog", { name: "Remove super admin" }).getByRole("button", { name: "Remove super admin" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await eventually(() => isSuper(USERS.newcomer), "f");
  assert.equal(sql(`select string_agg(change, ', ' order by at) from role_log where user_id = '${USERS.newcomer.id}' and workspace_id is null`), "made super admin, super admin removed");
});

test("the database keeps the guard rails: one super admin at least, and an owner for every workspace", async () => {
  await manage(USERS.superAdmin);
  await page.getByRole("region", { name: "Full permissions" }).getByLabel(/Super admin/).click();
  const dlg = page.getByRole("dialog", { name: "Remove super admin" });
  await dlg.getByRole("button", { name: "Remove super admin" }).click();
  await dlg.getByText("There must always be at least one super admin").waitFor();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await eventually(() => isSuper(USERS.superAdmin), "t");

  await manage(USERS.owner);
  await page.getByTestId(`perm-${WS_NAME}`).getByLabel(`Role in ${WS_NAME}`).selectOption({ label: "Admin" });
  await page.getByRole("alert").getByText(/A workspace needs an owner/).waitFor();
  await eventually(() => roleOf(USERS.owner), "owner true false");
  sa.expectRefusals(2);
  await page.waitForTimeout(500);
  await shot(page, "admin-permissions-owner");
});

test("no page reported an error along the way", () => sa.clean());
