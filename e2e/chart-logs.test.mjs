// End to end: the main super admin (protected from other super admins), the Logs page (every action of every
// user, from the database), and the chart of accounts approved by a super admin, with old heads merged into it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, newSession, login, openLedger, newEntry, rowFor, reseed, sql, shot, BASE } from "./helpers.mjs";
import { USERS, WS, CAT, PERSON, BANK } from "./fixtures.mjs";

let browser, sa, page;
before(async () => {
  reseed();
  // A donation under the old "Donation" head, to be merged into the chart's head later.
  sql(`insert into entries (workspace_id, type, entry_date, amount, category_id, person_id, payment_mode, note, created_by)
       values ('${WS}', 'income', '2026-11-20', 2100, '${CAT.donation}', '${PERSON.ramesh}', 'Cash', 'old-head-donation', '${USERS.owner.id}')`);
  // The newcomer is a second super admin: same powers, except over the main one.
  sql(`update profiles set super_admin = true where id = '${USERS.newcomer.id}'`);
  browser = await launch();
  sa = await newSession(browser); page = sa.page;
  await login(page, USERS.superAdmin);
});
after(async () => { await sa?.close(); await browser?.close(); });

const status = async (p = page) => { const s = p.getByRole("status"); await s.waitFor(); return (await s.textContent()).trim(); };
async function rpcStatus(p, fn, args) {
  return p.evaluate(async ({ fn, args }) => {
    const raw = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    const token = JSON.parse(localStorage.getItem(raw)).access_token;
    const r = await fetch(`http://127.0.0.1:54321/rest/v1/rpc/${fn}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: "x" }, body: JSON.stringify(args) });
    return { status: r.status, body: await r.text() };
  }, { fn, args });
}
async function openSetup(p) {
  await p.goto(`${BASE}/app/accounts`);
  await p.getByRole("heading", { name: "Accounts" }).waitFor();
  await p.getByRole("button", { name: "Setup" }).click();
  await p.getByRole("region", { name: "Chart of accounts" }).getByRole("heading", { name: "Chart of accounts" }).waitFor();
  await p.getByText("Loading the chart of accounts…").waitFor({ state: "detached" });
  return p.getByRole("region", { name: "Chart of accounts" });
}

// ------------------------------------------------------------------ the main super admin
test("a second super admin has the same powers, but cannot touch the main super admin", async () => {
  const n = await newSession(browser);
  try {
    await login(n.page, USERS.newcomer);
    await n.page.goto(`${BASE}/app/admin`);
    await n.page.getByRole("heading", { name: /All users/ }).waitFor();
    assert.match(await n.page.getByTestId(`user-${USERS.superAdmin.email}`).textContent(), /Main super admin/);

    // Equal powers: they manage anyone else.
    await n.page.getByRole("button", { name: `Manage ${USERS.editor.email}` }).click();
    await n.page.getByTestId("perm-E2E Temple").getByLabel("Full view in E2E Temple").click();
    await n.page.getByRole("status").waitFor();
    for (let t = 0; sql(`select see_all from members where user_id = '${USERS.editor.id}'`) !== "t" && t < 50; t++) await n.page.waitForTimeout(100);
    assert.equal(sql(`select see_all from members where user_id = '${USERS.editor.id}'`), "t");

    // ...but the main one's controls are locked, and the database refuses a hand-made request.
    await n.page.getByLabel("User to manage").selectOption({ label: `${USERS.superAdmin.name} — ${USERS.superAdmin.email}` });
    const full = n.page.getByRole("region", { name: "Full permissions" });
    await full.getByText(USERS.superAdmin.email).waitFor();
    assert.ok(await full.getByLabel(/Super admin/).isDisabled());
    assert.match(await n.page.getByTestId("main-note").textContent(), /Other super admins cannot change their access or delete their account/);
    assert.ok(await n.page.getByLabel("Role in E2E Temple").isDisabled());
    const demote = await rpcStatus(n.page, "admin_set_super_admin", { p_user: USERS.superAdmin.id, p_on: false });
    assert.equal(demote.status, 400); assert.match(demote.body, /main super admin always keeps full access/);
    const add = await rpcStatus(n.page, "admin_set_member", { p_ws: WS, p_user: USERS.superAdmin.id, p_role: "viewer" });
    assert.equal(add.status, 400); assert.match(add.body, /cannot be changed by anyone else/);
    n.expectRefusals(2);
    assert.equal(sql(`select super_admin and main_super_admin from profiles where id = '${USERS.superAdmin.id}'`), "t");
    await shot(n.page, "main-super-admin-locked");
    n.clean();
  } finally { await n.close(); }
});

test("the main super admin's account cannot be deleted", async () => {
  await page.goto(`${BASE}/app/settings`);
  await page.getByText("As the main super admin, your account cannot be deleted.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Delete my account" }).count(), 0);
  const del = await rpcStatus(page, "delete_account", {});
  assert.equal(del.status, 400); assert.match(del.body, /cannot be deleted/);
  sa.expectRefusals(1);
  assert.equal(sql(`select count(*) from auth.users where id = '${USERS.superAdmin.id}'`), "1");
});

// ------------------------------------------------------------------ logs
test("Logs shows each action with who did it: an entry user adds, the owner changes", async () => {
  const e = await newSession(browser);
  try {
    await login(e.page, USERS.editor);
    assert.equal(await e.page.getByRole("link", { name: "Logs", exact: true }).count(), 0, "entry users have no Logs");
    await e.page.goto(`${BASE}/app/logs`);
    await e.page.getByText("Only owners, admins and super admins can see the logs.").waitFor();
    await openLedger(e.page);
    await newEntry(e.page, { amount: 300, date: "2026-11-21", category: "Annadanam", note: "logged-entry" });
    e.clean();
  } finally { await e.close(); }
  const voucher = sql("select voucher_no from entries where note = 'logged-entry'");

  const o = await newSession(browser);
  try {
    await login(o.page, USERS.owner);
    await openLedger(o.page);
    await rowFor(o.page, voucher).click();
    await o.page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
    const dlg = o.page.getByRole("dialog");
    await dlg.getByLabel(/^Amount/).fill("350");
    await dlg.getByRole("button", { name: "Save changes" }).click();
    await o.page.getByRole("dialog").waitFor({ state: "detached" });

    await o.page.getByRole("link", { name: "Logs", exact: true }).click();
    await o.page.getByRole("heading", { name: "Logs" }).waitFor();
    const act = o.page.getByRole("region", { name: "Activity" });
    const added = act.getByTestId("log-row").filter({ hasText: `Added Expense ${voucher} · ₹300 · Annadanam` });
    await added.waitFor();
    assert.match(await added.textContent(), /Esha Editor/);
    const changed = act.getByTestId("log-row").filter({ hasText: `Changed Expense ${voucher} · ₹350 · Annadanam — amount` });
    assert.match(await changed.textContent(), /Olivia Owner/);
    await changed.getByRole("button", { name: "Details" }).click();
    await act.getByText(/300\s*→\s*350/).waitFor();

    // Filters
    await o.page.getByLabel("Who").selectOption({ label: USERS.editor.name });
    await act.getByTestId("log-row").filter({ hasText: "Olivia Owner" }).first().waitFor({ state: "detached" });
    assert.ok(await act.getByTestId("log-row").count() >= 1);
    for (const t of await act.getByTestId("log-row").allTextContents()) assert.match(t, /Esha Editor/);
    await o.page.getByLabel("Who").selectOption({ label: "Everyone" });
    await o.page.getByLabel("Search logs").fill(voucher.slice(-4));
    await changed.waitFor();
    assert.equal(await o.page.getByLabel("Workspace").count(), 0, "owners see only their workspace");
    await shot(o.page, "logs-owner");
    o.clean();
  } finally { await o.close(); }
});

test("the super admin's Logs cover every workspace, role changes included", async () => {
  await page.goto(`${BASE}/app/logs`);
  await page.getByRole("heading", { name: "Logs" }).waitFor();
  await page.getByLabel("Workspace").selectOption("all");
  await page.getByLabel("Area").selectOption("Members & roles");
  const act = page.getByRole("region", { name: "Activity" });
  await act.getByTestId("log-row").filter({ hasText: /Changed Esha Editor — full view on/ }).waitFor();
  assert.match(await act.getByTestId("log-row").filter({ hasText: /full view on/ }).first().textContent(), /Nila Newcomer/);
  assert.equal(sql("select count(*) from activity_log where area = 'Members & roles' and summary like 'Changed Esha Editor — full view on'"), "1");
});

// ------------------------------------------------------------------ chart of accounts
test("the owner sees the chart as a draft awaiting the super admin", async () => {
  const o = await newSession(browser);
  try {
    await login(o.page, USERS.owner);
    const chart = await openSetup(o.page);
    assert.equal((await chart.getByTestId("chart-state").textContent()).trim(), "Draft — awaiting super admin approval");
    assert.equal(await chart.getByRole("button", { name: /Approve/ }).count(), 0);
    await chart.getByText("A super admin approves the chart; until then the heads stay as they are.").waitFor();
    assert.match(await chart.getByTestId("chart-Donations – received in bank").textContent(), /＋/);
    assert.match(await chart.getByTestId("chart-Gaushala").textContent(), /✓ Gaushala\s*Goshala/);
    o.clean();
  } finally { await o.close(); }
});

test("the super admin approves the chart: its heads appear in their books", async () => {
  const chart = await openSetup(page);
  const missing = Number(sql(`select count(*) from chart_of_accounts() c where c.kind is not null and not exists (select 1 from categories h where h.workspace_id = '${WS}' and h.kind = c.kind and lower(h.name) = lower(c.name))`))
    + Number(sql(`select count(*) from chart_of_accounts() c where c.name like 'Bank – %' and not exists (select 1 from bank_accounts b where b.workspace_id = '${WS}' and lower(b.name) = lower(substr(c.name, 8)))`));
  await chart.getByRole("button", { name: "Approve the chart of accounts" }).click();
  await page.getByRole("dialog", { name: "Approve the chart of accounts" }).getByRole("button", { name: "Approve and apply" }).click();
  assert.equal(await status(), `Chart of accounts approved: ${missing} lines added.`);
  assert.match(await chart.getByTestId("chart-state").textContent(), /Approved .* by Sundar Super/);
  assert.equal(await chart.getByText("＋").count(), 0);
  assert.equal(sql(`select string_agg(name || ':' || book || case when is_capital then ':capital' else '' end, ', ' order by name) from categories
                    where workspace_id = '${WS}' and name in ('Gaushala', 'Purchase of books', 'Construction – Building', 'Donations – received in bank', 'Bank charges')`),
    "Bank charges:temple, Construction – Building:temple:capital, Donations – received in bank:temple, Gaushala:goshala, Purchase of books:books");
  assert.equal(sql(`select count(*) from bank_accounts where workspace_id = '${WS}' and name in ('Ujjivan Small Finance Bank', 'IDFC FIRST')`), "2");
  await shot(page, "chart-approved");
});

test("an old head merges into the chart's, its voucher keeping its number", async () => {
  const chart = page.getByRole("region", { name: "Chart of accounts" });
  const before = sql("select voucher_no from entries where note = 'old-head-donation'");
  const other = chart.getByTestId("other-Donation");
  assert.match(await other.textContent(), /income · 1 voucher/);
  await other.getByLabel("Merge Donation into").selectOption({ label: "Donations – received in bank" });
  await other.getByRole("button", { name: "Merge" }).click();
  await page.getByRole("dialog", { name: "Merge heads" }).getByRole("button", { name: "Merge", exact: true }).click();
  await page.getByRole("status").getByText("Merged Donation into Donations – received in bank: 1 voucher moved.").waitFor();
  await chart.getByTestId("other-Donation").waitFor({ state: "detached" });
  assert.equal(sql("select voucher_no || ' ' || (select name from categories where id = category_id) from entries where note = 'old-head-donation'"), `${before} Donations – received in bank`);
  assert.equal(sql(`select count(*) from categories where id = '${CAT.donation}'`), "0");
  // Only chart heads are offered: an expense head is not a choice for an income head.
  const hundi = chart.getByTestId("other-Hundi").getByLabel("Merge Hundi into");
  const offered = await hundi.locator("option").allTextContents();
  assert.deepEqual(offered.slice(1).sort(), ["Donations – received in bank", "Donations – received in cash", "Interest on savings bank accounts", "Sale of books"]);

  await page.goto(`${BASE}/app/logs`);
  const act = page.getByRole("region", { name: "Activity" });
  await act.getByTestId("log-row").filter({ hasText: "Merged head Donation into Donations – received in bank (1 voucher moved)" }).waitFor();
  await act.getByTestId("log-row").filter({ hasText: "Approved the chart of accounts" }).waitFor();
  // Opening balances read as account names, not internal keys.
  sql(`insert into opening_balances (workspace_id, book, account, amount) values
       ('${WS}', 'temple', 'bank:${BANK.ujjivan}', 500), ('${WS}', 'temple', 'capital_fund', -500)`);
  assert.equal(sql("select string_agg(summary, ' | ' order by id) from activity_log where area = 'Books setup'"),
    "Added opening balance Bank – Ujjivan (temple) ₹500 | Added opening balance Capital Fund (temple) -₹500");
  await shot(page, "logs-super-admin");
});

test("no page reported an error along the way", () => sa.clean());
