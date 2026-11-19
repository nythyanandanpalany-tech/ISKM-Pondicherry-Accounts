// End to end: a sevak adds entries in the real app, and the real database numbers them.
// Chromium drives the app; PostgREST and the actual schema (triggers, row level security) sit behind it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, newSession, login, openLedger, addEntry, saveEntry, newEntry, rowFor, reseed, sql, shot } from "./helpers.mjs";
import { USERS, WS } from "./fixtures.mjs";

let browser, s, page;
before(async () => { reseed(); browser = await launch(); s = await newSession(browser); page = s.page; await login(page, USERS.owner); });
after(async () => { await s?.close(); await browser?.close(); });

const voucherOf = (note) => sql(`select coalesce(voucher_no,'(none)') from entries where note = '${note}'`);

test("the form says which voucher an entry will become, before it is saved", async () => {
  await openLedger(page);
  const dlg = await addEntry(page, { amount: 10, date: "2026-11-19", mode: "UPI" });
  await dlg.getByText(/Recorded as a/).waitFor();
  const text = async () => (await dlg.getByText(/Recorded as a|gets no voucher number/).first().textContent()).replace(/\s+/g, " ");
  assert.match(await text(), /Bank Voucher \(BV\).*2026-2027\/BV\/11/);
  await dlg.locator("label").filter({ hasText: /^Cash$/ }).click();
  assert.match(await text(), /Cash Voucher \(CV\).*2026-2027\/CV\/11/);
  await dlg.locator("label").filter({ hasText: /^Income$/ }).click();
  assert.match(await text(), /Cash Receipt \(CR\).*2026-2027\/CR\/11/);
  await dlg.locator("label").filter({ hasText: /^UPI$/ }).click();
  assert.match(await text(), /Bank Receipt \(BR\)/);
  await dlg.getByLabel(/^Date/).fill("2026-10-31");
  assert.match(await text(), /Dated before 01\/11\/2026.*no voucher number/);
  await dlg.getByLabel(/^Date/).fill("2027-04-05");
  assert.match(await text(), /2027-2028\/BR\/04/);
  await shot(page, "voucher-preview");
  await page.keyboard.press("Escape");
});

test("a cash expense with no bill becomes Cash Voucher V001 and is flagged No bill", async () => {
  await openLedger(page);
  await newEntry(page, { amount: 100, date: "2026-11-19", category: "Annadanam", mode: "Cash", note: "e2e-cv" });
  const row = rowFor(page, "2026-2027/CV/11/V001");
  await row.waitFor();
  assert.match(await row.textContent(), /No bill/);
  assert.equal(voucherOf("e2e-cv"), "2026-2027/CV/11/V001");
  assert.equal(sql("select no_bill from entries where note = 'e2e-cv'"), "t");
  await shot(page, "ledger-first-voucher");
});

test("a bank voucher cannot be saved without saying which bank, then numbers as BV V001", async () => {
  await openLedger(page);
  const dlg = await addEntry(page, { amount: 200, date: "2026-11-19", category: "Annadanam", mode: "UPI", note: "e2e-bv1" });
  const msg = await saveEntry(page, dlg, { expectError: true });
  assert.match(msg, /Choose which bank account/);
  assert.equal(sql("select count(*) from entries where note = 'e2e-bv1'"), "0");
  await dlg.getByLabel(/^Bank account/).selectOption({ label: "Ujjivan" });
  await saveEntry(page, dlg);
  assert.equal(voucherOf("e2e-bv1"), "2026-2027/BV/11/V001");
  assert.equal(sql("select b.name from entries e join bank_accounts b on b.id = e.bank_account_id where e.note = 'e2e-bv1'"), "Ujjivan");
});

test("the next bank voucher in the month takes the next serial", async () => {
  await openLedger(page);
  await newEntry(page, { amount: 50, date: "2026-11-20", category: "Annadanam", mode: "UPI", bank: "IDFC", note: "e2e-bv2" });
  await rowFor(page, "2026-2027/BV/11/V002").waitFor();
  assert.equal(voucherOf("e2e-bv2"), "2026-2027/BV/11/V002");
});

test("cash and bank donations become CR and BR, each with its own serial", async () => {
  await openLedger(page);
  await newEntry(page, { type: "income", amount: 500, date: "2026-11-21", category: "Donation", mode: "Cash", note: "e2e-cr" });
  await newEntry(page, { type: "income", amount: 400, date: "2026-11-22", category: "Donation", mode: "Bank Transfer", bank: "Ujjivan", person: "Ramesh", note: "e2e-br" });
  await rowFor(page, "2026-2027/CR/11/V001").waitFor();
  await rowFor(page, "2026-2027/BR/11/V001").waitFor();
  assert.equal(voucherOf("e2e-cr"), "2026-2027/CR/11/V001");
  assert.equal(voucherOf("e2e-br"), "2026-2027/BR/11/V001");
});

test("an entry from before 1 November 2026 gets no voucher number", async () => {
  await openLedger(page);
  await newEntry(page, { amount: 75, date: "2026-10-31", category: "Festival", mode: "Cash", note: "e2e-old" });
  const row = page.locator("tbody tr").filter({ hasText: "e2e-old" });
  await row.waitFor();
  assert.doesNotMatch(await row.textContent(), /\d{4}-\d{4}\//);
  assert.equal(voucherOf("e2e-old"), "(none)");
});

test("a new month and a new financial year each start their own series", async () => {
  await openLedger(page);
  await newEntry(page, { amount: 60, date: "2026-12-05", category: "Annadanam", mode: "UPI", bank: "Ujjivan", note: "e2e-dec" });
  await newEntry(page, { amount: 70, date: "2027-04-05", category: "Annadanam", mode: "UPI", bank: "Ujjivan", note: "e2e-apr" });
  await newEntry(page, { amount: 80, date: "2027-03-31", category: "Annadanam", mode: "UPI", bank: "Ujjivan", note: "e2e-mar" });
  assert.equal(voucherOf("e2e-dec"), "2026-2027/BV/12/V001");
  assert.equal(voucherOf("e2e-mar"), "2026-2027/BV/03/V001");      // still the 2026-27 year
  assert.equal(voucherOf("e2e-apr"), "2027-2028/BV/04/V001");      // the next one begins on 1 April
  await rowFor(page, "2027-2028/BV/04/V001").waitFor();
});

test("changing cash to UPI moves the entry to a bank voucher and keeps the old number in its history", async () => {
  await openLedger(page);
  await rowFor(page, "2026-2027/CV/11/V001").click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Edit entry" }).waitFor();
  assert.match((await dlg.getByText(/Voucher 2026-2027\/CV\/11\/V001/).first().textContent()), /Cash Voucher/);
  await dlg.locator("label").filter({ hasText: /^UPI$/ }).click();
  await dlg.getByText(/it will move from/).waitFor();
  await dlg.getByLabel(/^Bank account/).selectOption({ label: "Ujjivan" });
  await saveEntry(page, dlg);
  await rowFor(page, "2026-2027/BV/11/V003").waitFor();
  assert.equal(await rowFor(page, "2026-2027/CV/11/V001").count(), 0);
  assert.equal(voucherOf("e2e-cv"), "2026-2027/BV/11/V003");
  assert.equal(sql("select count(*) from entry_log where snapshot->>'voucher_no' = '2026-2027/CV/11/V001'"), "1");
});

test("editing only the amount keeps the voucher number", async () => {
  await openLedger(page);
  await rowFor(page, "2026-2027/BV/11/V001").click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^Amount/).fill("210");
  await saveEntry(page, dlg);
  assert.equal(voucherOf("e2e-bv1"), "2026-2027/BV/11/V001");
  assert.equal(sql("select amount from entries where note = 'e2e-bv1'"), "210.00");
});

test("the No bill filter lists the self-vouchers and hides the income", async () => {
  await openLedger(page);
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByText("Documents").locator("..").locator("select").selectOption({ label: "No bill (self-voucher)" });
  const expenses = Number(sql("select count(*) from entries where type = 'expense' and no_bill"));
  await page.waitForFunction((n) => document.querySelectorAll("tbody tr").length === n, expenses);
  assert.equal(await rowFor(page, "2026-2027/CR/11/V001").count(), 0);
});

test("the ledger can be searched by voucher number", async () => {
  await openLedger(page);
  await page.getByPlaceholder(/Search/).fill("BR/11/V001");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  assert.match(await page.locator("tbody tr").first().textContent(), /2026-2027\/BR\/11\/V001/);
});

test("every number is unique, and everything the screen saved is in the database", async () => {
  assert.equal(sql(`select count(*) - count(distinct voucher_no) from entries where workspace_id = '${WS}' and voucher_no is not null`), "0");
  assert.equal(sql(`select count(*) from entries where workspace_id = '${WS}'`), "9");
  s.clean();
});
