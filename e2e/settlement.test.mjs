// End to end: weekly settlement. The scenario's first week (Monday 2 – Sunday 8 November 2026) is
// worked through in Chromium: the bank is matched, the cash is counted, the week is settled, and a
// later entry in that week is pointed out.
//
//   In the week:  CV 100 · BV 200 Ujjivan · CR 500 · BR 400 Ujjivan · CV 300 Gaushala · BV 50 IDFC
//   Cash book:    5,000 opening − 100 + 500 − 300 = 5,100 at the end of Sunday 8 November
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, newSession, login, reseed, sql, addEntry, saveEntry, BASE } from "./helpers.mjs";
import { loadScenario } from "./scenario.mjs";
import { USERS, WS } from "./fixtures.mjs";

let browser, s, page;
before(async () => { reseed(); loadScenario(); browser = await launch(); s = await newSession(browser); page = s.page; await login(page, USERS.owner); });
after(async () => { await s?.close(); await browser?.close(); });

const WEEK = "Week 02/11/2026 – 08/11/2026";
const detail = () => page.getByRole("region", { name: WEEK });
const tick = (label) => detail().getByRole("img", { name: new RegExp(`^${label}: `) });
const tickState = async (label) => (await tick(label).getAttribute("aria-label")).endsWith(": done");
const status = () => detail().locator("span.rounded-full").first();

async function openWeek() {
  await page.goto(`${BASE}/app/settlement`);
  await page.getByRole("heading", { name: "Weekly settlement" }).waitFor();
  await page.getByText("Loading the weeks…").waitFor({ state: "detached" });
  await page.getByRole("region", { name: "Weeks" }).getByRole("button", { name: "02/11/2026 – 08/11/2026" }).click();
  await detail().waitFor();
}

test("owners reach Weekly settlement from the menu; every week since the vouchers began is listed", async () => {
  await page.goto(`${BASE}/app`);
  await page.getByRole("link", { name: "Weekly settlement" }).first().click();
  await page.getByRole("heading", { name: "Weekly settlement" }).waitFor();
  await page.getByText("Loading the weeks…").waitFor({ state: "detached" });
  const weeks = page.getByRole("region", { name: "Weeks" });
  // The vouchers start on Sunday 1 November, so the first week is the one that ends that day.
  await weeks.getByRole("button", { name: "26/10/2026 – 01/11/2026" }).waitFor();
  await weeks.getByRole("button", { name: "02/11/2026 – 08/11/2026" }).waitFor();
  // The newest week is still running (or has just ended) — it is never "Not settled" before its Sunday.
  const first = weeks.getByRole("row").nth(1);
  assert.match(await first.textContent(), /Week in progress|Ready to settle|Not settled/);
});

test("the week starts open: bank unmatched, cash not counted; the trial balance tallies and no bill is waiting", async () => {
  await openWeek();
  assert.equal(await tickState("Bank matched"), false);
  assert.equal(await tickState("Cash counted"), false);
  assert.equal(await tickState("Trial balance tallies"), true);
  assert.equal(await tickState("Bills attached"), true);
  assert.equal(await status().textContent(), "Not settled");
  assert.match(await detail().textContent(), /0 of 3 bank voucher\(s\) matched/);
  assert.match(await detail().textContent(), /cash book says ₹\s?5,100\.00 at the end of Sunday 08\/11\/2026/);
  assert.match(await detail().textContent(), /self-voucher\(s\) flagged “No bill” — allowed/);
  assert.ok(await detail().getByRole("button", { name: "Mark week settled" }).isDisabled());
});

test("bank: once the statement rows are matched it passes; a statement row with no entry is listed until dealt with", async () => {
  sql(`insert into bank_transactions (workspace_id, txn_date, description, amount, direction, matched_entry_id)
       select workspace_id, entry_date, 'stmt ' || note, amount, case when type = 'income' then 'credit' else 'debit' end, id
         from entries where workspace_id = '${WS}' and entry_date between '2026-11-02' and '2026-11-08' and lower(payment_mode) <> 'cash';
       insert into bank_transactions (workspace_id, txn_date, description, amount, direction) values ('${WS}', '2026-11-07', 'SMS CHARGES', 17.70, 'debit');`);
  await openWeek();
  assert.match(await detail().textContent(), /3 of 3 bank voucher\(s\) matched/);
  assert.equal(await tickState("Bank matched"), false);
  assert.match(await detail().textContent(), /On the statement, with no entry.*SMS CHARGES/);
  sql(`delete from bank_transactions where description = 'SMS CHARGES'`);
  await openWeek();
  assert.equal(await tickState("Bank matched"), true);
});

test("cash: a count that does not agree says by how much; the right count passes", async () => {
  await detail().getByLabel("Cash counted", { exact: true }).fill("5000");
  await detail().getByRole("button", { name: "Save count" }).click();
  await detail().getByText(/₹\s?100\.00 less than the cash book/).waitFor();
  assert.equal(await tickState("Cash counted"), false);
  await detail().getByLabel("Cash counted", { exact: true }).fill("5,100");
  await detail().getByLabel("Cash count note").fill("counted after the Sunday feast");
  await detail().getByRole("button", { name: "Save count" }).click();
  await detail().getByText("The count agrees with the cash book.").waitFor();
  assert.equal(await tickState("Cash counted"), true);
  assert.equal(sql(`select cash_counted || '|' || cash_note || '|' || counted_by from week_settlements where week_start = '2026-11-02'`), `5100.00|counted after the Sunday feast|${USERS.owner.id}`);
});

test("with all four checks passing the week is settled, and the database records who settled it", async () => {
  assert.equal(await status().textContent(), "Ready to settle");
  await detail().getByRole("button", { name: "Mark week settled" }).click();
  await detail().getByText(/^Settled by Olivia Owner on /).waitFor();
  assert.equal(await status().textContent(), "Settled");
  assert.equal(sql(`select settled_by from week_settlements where week_start = '2026-11-02'`), USERS.owner.id);
  const row = page.getByRole("region", { name: "Weeks" }).getByRole("row").filter({ hasText: "02/11 – 08/11/2026" });
  assert.match(await row.textContent(), /Settled/);
});

test("settling locks nothing: a later entry in the week is accepted, and the week says it changed", async () => {
  await page.goto(`${BASE}/app/ledger`);
  const dlg = await addEntry(page, { amount: 20, date: "2026-11-05", category: "Festival", mode: "Cash", note: "flowers" });
  await saveEntry(page, dlg);
  await openWeek();
  assert.equal(await status().textContent(), "Settled — changed since");
  assert.equal(await tickState("Cash counted"), false);                                // the book is now 5,080
  await detail().getByText(/₹\s?20\.00 more than the cash book/).waitFor();
  assert.ok(await detail().getByRole("button", { name: "Settle again" }).isDisabled());

  // The form will not save a bill that is promised but not attached, but an imported or older entry can be one.
  sql(`update entries set receipt_available = true, note = 'flowers, bill to come' where note = 'flowers'`);
  await openWeek();
  assert.equal(await tickState("Bills attached"), false);
  assert.match(await detail().textContent(), /1 expense\(s\) are waiting for their bill.*flowers, bill to come/);
});

test("undoing a settlement reopens the week", async () => {
  await detail().getByRole("button", { name: "Undo settlement" }).click();
  await detail().getByRole("button", { name: "Mark week settled" }).waitFor();
  assert.equal(await status().textContent(), "Not settled");
  assert.equal(sql(`select (settled_at is null)::text from week_settlements where week_start = '2026-11-02'`), "true");
});

test("an editor has no Weekly settlement in the menu and cannot open it", async () => {
  const e = await newSession(browser);
  await login(e.page, USERS.editor);
  assert.equal(await e.page.getByRole("link", { name: "Weekly settlement" }).count(), 0);
  await e.page.goto(`${BASE}/app/settlement`);
  await e.page.getByText("Only owners and admins can settle the weeks.").waitFor();
  e.clean(); await e.close();
});

test("no page reported an error along the way", () => s.clean());
