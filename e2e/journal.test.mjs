// End to end: journal vouchers, paying a bill that was booked as unpaid, and who is allowed to do what.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, newSession, login, openLedger, addEntry, saveEntry, rowFor, reseed, sql, shot, BASE } from "./helpers.mjs";
import { USERS } from "./fixtures.mjs";

let browser, owner, page;
before(async () => { reseed(); browser = await launch(); owner = await newSession(browser); page = owner.page; await login(page, USERS.owner); });
after(async () => { await owner?.close(); await browser?.close(); });

const radio = (scope, text) => scope.locator("label").filter({ hasText: new RegExp(`^${text}$`) });

async function openJournal(p) {
  await p.getByRole("button", { name: "+ Add entry" }).first().click();
  await radio(p.getByRole("dialog"), "Journal").click();
  await p.getByRole("heading", { name: "New journal voucher" }).waitFor();
  return p.getByRole("dialog");
}
async function fillJournal(dlg, { kind, amount, date, dr, cr, note }) {
  if (kind) await radio(dlg, kind).click();
  await dlg.getByLabel(/^Amount/).fill(String(amount));
  await dlg.getByLabel(/^Date/).fill(date);
  if (dr) await dlg.getByLabel(/^Debit/).selectOption({ label: dr });
  if (cr) await dlg.getByLabel(/^Credit/).selectOption({ label: cr });
  if (note != null) await dlg.getByLabel(/^Narration/).fill(note);
}
const submitJournal = (dlg) => dlg.getByRole("button", { name: /^(Add journal voucher|Save changes)$/ }).click();
const alertText = async (dlg) => { const a = dlg.getByRole("alert"); await a.waitFor(); return (await a.textContent()).trim(); };

test("an owner is offered Journal next to Expense and Income", async () => {
  await openLedger(page);
  await page.getByRole("button", { name: "+ Add entry" }).first().click();
  const dlg = page.getByRole("dialog");
  for (const t of ["Expense", "Income", "Journal"]) await radio(dlg, t).waitFor();
  await page.keyboard.press("Escape");
});

test("a journal needs a narration, and a transfer needs two different heads", async () => {
  await openLedger(page);
  const dlg = await openJournal(page);
  await fillJournal(dlg, { amount: 1000, date: "2026-11-05", dr: "Annadanam", note: "   " });   // blanks pass the browser's `required`, not ours
  await submitJournal(dlg);
  assert.match(await alertText(dlg), /narration/i);

  await fillJournal(dlg, { kind: "Move an amount between heads", amount: 100, date: "2026-11-05", dr: "Annadanam", cr: "Annadanam", note: "same head" });
  await submitJournal(dlg);
  assert.match(await alertText(dlg), /must be different/);

  await fillJournal(dlg, { amount: 100, date: "2026-10-30", dr: "Annadanam", cr: "Festival", note: "too early" });
  await submitJournal(dlg);
  assert.match(await alertText(dlg), /numbered from 01\/11\/2026/);
  assert.equal(sql("select count(*) from entries"), "0");
  await page.keyboard.press("Escape");
});

test("a bill not yet paid becomes Journal Voucher V001, debiting the head and crediting Outstanding expenses", async () => {
  await openLedger(page);
  const dlg = await openJournal(page);
  await dlg.getByText(/Numbered .*2026-2027\/JV\/11\/V…/).waitFor();
  await fillJournal(dlg, { amount: 1000, date: "2026-11-05", dr: "Annadanam", note: "October electricity bill" });
  assert.equal(await dlg.getByText("Outstanding expenses", { exact: true }).count(), 1);   // the fixed credit side
  await submitJournal(dlg);
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const row = rowFor(page, "2026-2027/JV/11/V001");
  await row.waitFor();
  assert.match(await row.textContent(), /Dr Annadanam · Cr Outstanding expenses/);
  assert.equal(sql("select voucher_type || '|' || jv_kind || '|' || amount from entries where note = 'October electricity bill'"), "JV|unpaid_bill|1000.00");
  await shot(page, "journal-in-ledger");
});

test("a journal is not an expense: the ledger totals do not move", async () => {
  await openLedger(page);
  const card = (label) => page.getByText(label, { exact: true }).locator("xpath=..");
  assert.match(await card("Expenses").textContent(), /₹0(?!\d)/);
  assert.match(await card("Income").textContent(), /₹0(?!\d)/);
});

test("a journal between two heads is numbered in the same series", async () => {
  await openLedger(page);
  const dlg = await openJournal(page);
  await fillJournal(dlg, { kind: "Correct a mistake", amount: 100, date: "2026-11-06", dr: "Festival", cr: "Gaushala", note: "Booked to Gaushala by mistake" });
  await submitJournal(dlg);
  await rowFor(page, "2026-2027/JV/11/V002").waitFor();
  assert.equal(sql("select dr.name || ' <- ' || cr.name from entries e join categories dr on dr.id = e.dr_category_id join categories cr on cr.id = e.cr_category_id where e.voucher_no like '%/JV/11/V002'"), "Festival <- Gaushala");
});

test("paying the bill offers it by name, and clears it instead of charging the expense again", async () => {
  await openLedger(page);
  const dlg = await addEntry(page, { amount: 400, date: "2026-11-20", mode: "UPI", bank: "Ujjivan", note: "first instalment", settles: /JV\/11\/V001/ });
  await dlg.getByText(/not counted as an expense a second time/).waitFor();
  assert.match(await dlg.getByLabel(/^Category/).inputValue(), /.+/);                          // taken from the bill
  await saveEntry(page, dlg);
  assert.equal(sql("select (settles_entry_id = (select id from entries where voucher_no like '%/JV/11/V001'))::text from entries where note = 'first instalment'"), "true");
  assert.equal(sql("select voucher_no from entries where note = 'first instalment'"), "2026-2027/BV/11/V001");
});

test("a payment larger than what is still unpaid is refused with a plain message", async () => {
  await openLedger(page);
  const dlg = await addEntry(page, { amount: 700, date: "2026-11-21", mode: "UPI", bank: "Ujjivan", note: "too much", settles: /JV\/11\/V001/ });
  const msg = await saveEntry(page, dlg, { expectError: true });
  assert.match(msg, /more than is still unpaid/);
  owner.expectRefusals(1);
  assert.equal(sql("select count(*) from entries where note = 'too much'"), "0");
  await page.keyboard.press("Escape");
});

test("the rest can be paid, and then the bill is no longer offered", async () => {
  await openLedger(page);
  const dlg = await addEntry(page, { amount: 600, date: "2026-11-22", mode: "UPI", bank: "Ujjivan", note: "final instalment", settles: /JV\/11\/V001/ });
  await saveEntry(page, dlg);
  assert.equal(sql("select sum(amount) from entries where settles_entry_id is not null"), "1000.00");
  // The form fetches what is still unpaid when it opens; wait for that answer, then look.
  const asked = page.waitForResponse((r) => r.url().includes("settles_entry_id=not.is.null") && r.request().method() === "GET");
  await page.getByRole("button", { name: "+ Add entry" }).first().click();
  await asked;
  const next = page.getByRole("dialog");
  await next.getByLabel(/^Amount/).waitFor();
  assert.equal(await next.getByLabel(/pay a bill that was already booked/).count(), 0);
  await page.keyboard.press("Escape");
});

test("the journal shows how much of it has been paid", async () => {
  await openLedger(page);
  await rowFor(page, "2026-2027/JV/11/V001").click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("Debit", { exact: true }).waitFor();
  await dlg.getByText(/₹1,000 of ₹1,000/).waitFor();                      // the payments are looked up after it opens
  const text = (await dlg.textContent()).replace(/\s+/g, " ");
  assert.match(text, /Credit.*Outstanding expenses/);
  assert.match(text, /Paid so far.*₹1,000 of ₹1,000/);
  assert.match(text, /October electricity bill/);
  await shot(page, "journal-detail");
});

test("a journal that has payments against it cannot be deleted, and says why", async () => {
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this journal voucher" }).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText(/still used by existing entries or journal vouchers/).waitFor();
  owner.expectRefusals(1);
  assert.equal(sql("select count(*) from entries where jv_kind = 'unpaid_bill'"), "1");
  await page.keyboard.press("Escape");
});

test("an editor is not offered Journal, cannot settle a bill, and cannot open the books", async () => {
  const ed = await newSession(browser);
  try {
    await login(ed.page, USERS.editor);
    assert.equal(await ed.page.getByRole("link", { name: "Accounts", exact: true }).count(), 0);
    await ed.page.goto(`${BASE}/app/accounts`);
    await ed.page.getByText("Only owners and admins can open the books.").waitFor();

    await ed.page.goto(`${BASE}/app/ledger`);
    await ed.page.getByRole("button", { name: "+ Add entry" }).first().click();
    const dlg = ed.page.getByRole("dialog");
    await radio(dlg, "Expense").waitFor();
    assert.equal(await radio(dlg, "Journal").count(), 0);
    assert.equal(await dlg.getByLabel(/pay a bill that was already booked/).count(), 0);
    await ed.page.keyboard.press("Escape");
    ed.clean();
  } finally { await ed.close(); }
});

test("the database refuses a journal from an editor even if the screen is bypassed", async () => {
  // What a hand-made request would do: the same insert the Journal form sends, signed in as the editor.
  const ed = await newSession(browser);
  try {
    await login(ed.page, USERS.editor);
    const status = await ed.page.evaluate(async ({ ws, uid, cat }) => {
      const raw = Object.keys(localStorage).find((k) => k.includes("auth-token"));
      const token = JSON.parse(localStorage.getItem(raw)).access_token;
      const r = await fetch("http://127.0.0.1:54321/rest/v1/entries", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: "x" },
        body: JSON.stringify({ workspace_id: ws, created_by: uid, type: "journal", entry_date: "2026-11-10", amount: 5, payment_mode: "Journal", note: "sneaky", jv_kind: "unpaid_bill", dr_category_id: cat }),
      });
      return r.status;
    }, { ws: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", uid: USERS.editor.id, cat: "c0000000-0000-4000-8000-000000000001" });
    assert.ok(status === 401 || status === 403, `expected a refusal, got ${status}`);
    assert.equal(sql("select count(*) from entries where note = 'sneaky'"), "0");
  } finally { await ed.close(); }
});

test("no page reported an error along the way", () => owner.clean());
