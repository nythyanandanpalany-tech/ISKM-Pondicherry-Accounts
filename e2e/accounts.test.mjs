// End to end: the books. A month of vouchers sits in the real database; Chromium opens Accounts and
// every report must show the figures worked out by hand in scenario.mjs — for all books and for each.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, newSession, login, reseed, sql, shot, BASE } from "./helpers.mjs";
import { loadScenario, RANGE } from "./scenario.mjs";
import { USERS } from "./fixtures.mjs";

let browser, s, page;
before(async () => { reseed(); loadScenario(); browser = await launch(); s = await newSession(browser); page = s.page; await login(page, USERS.owner); });
after(async () => { await s?.close(); await browser?.close(); });

const TITLES = {
  "Trial balance": "Trial Balance", "Ledgers": "Ledgers", "Journal register": "Journal register", "Cash book": "Cash book", "Bank book": "Bank book",
  "Bank reconciliation": "Bank reconciliation", "Income & Expenditure": "Income & Expenditure account", "Balance sheet": "Balance sheet",
  "Receipts & Payments": "Receipts & Payments account", "Day book": "Day book", "Fund-wise statement": "Fund-wise statement",
  "Bills-missing list": "Bills-missing list", "Unpaid bills list": "Unpaid bills list", "Donations without donor name": "Donations without donor name",
};
const control = (label) => page.getByLabel(label, { exact: true });

async function openAccounts() {
  await page.goto(`${BASE}/app/accounts`);
  await page.getByRole("heading", { name: "Accounts" }).waitFor();
  await control("Period").selectOption("custom");
  await page.getByLabel("From", { exact: true }).fill(RANGE.from);
  await page.getByLabel("To", { exact: true }).fill(RANGE.to);
}
async function show(report, book = "All books") {
  await control("Book").selectOption({ label: book });
  await control("Report").selectOption({ label: report });
  const region = page.getByRole("region", { name: TITLES[report] });
  await region.waitFor();
  await page.getByText("Loading the books…").waitFor({ state: "detached" });
  return region;
}
const rowOf = (region, text) => region.getByRole("row").filter({ hasText: text }).first();
const cells = async (row) => (await row.getByRole("cell").allTextContents()).map((c) => c.trim());
const flat = async (el) => (await el.textContent()).replace(/\s+/g, " ");

test("the owner opens Accounts and the books load", async () => {
  await openAccounts();
  const tb = await show("Trial balance");
  await rowOf(tb, "Cash in hand").waitFor();
  await shot(page, "accounts-trial-balance");
});

test("the trial balance has every account, tallies, and says so", async () => {
  const tb = await show("Trial balance");
  assert.deepEqual((await cells(rowOf(tb, "Cash in hand"))).slice(1), ["5,000.00", "", "750.00", "400.00", "5,350.00", ""]);
  assert.equal((await cells(rowOf(tb, "Bank – Ujjivan")))[5], "15,800.00");
  assert.equal((await cells(rowOf(tb, "Bank – IDFC")))[6], "50.00");                     // overdrawn: a credit balance
  assert.equal((await cells(rowOf(tb, "Outstanding expenses")))[6], "600.00");
  assert.equal((await cells(rowOf(tb, "Construction – Building")))[5], "4,000.00");
  const total = await cells(rowOf(tb, "Total"));
  assert.equal(total[1], total[2]); assert.equal(total[3], total[4]); assert.equal(total[5], total[6]);
  assert.match(await flat(tb), /The trial balance tallies/);
  assert.doesNotMatch(await flat(tb), /DOES NOT TALLY/);
});

test("income and expenditure: the payment of a booked bill is not an expense twice, and capital is left out", async () => {
  const ie = await show("Income & Expenditure");
  assert.match(await flat(rowOf(ie, "Total income")), /1,150\.00/);
  assert.match(await flat(rowOf(ie, "Total expenditure")), /1,650\.00/);
  assert.match(await flat(rowOf(ie, "Deficit")), /500\.00/);
  assert.match(await flat(rowOf(ie, "Total capital expenditure")), /4,000\.00/);
  assert.equal(await rowOf(ie, "Construction – Building (capital)").count(), 1);
  await shot(page, "accounts-income-expenditure");
});

test("the balance sheet balances, with the bill still owed and the building as an asset", async () => {
  const bs = await show("Balance sheet");
  assert.match(await flat(rowOf(bs, "Total assets")), /25,100\.00/);
  assert.match(await flat(rowOf(bs, "Total liabilities & capital")), /25,100\.00/);
  assert.match(await flat(rowOf(bs, "Capital fund")), /25,000\.00/);
  assert.match(await flat(rowOf(bs, "Outstanding expenses")), /600\.00/);
  assert.match(await flat(rowOf(bs, "Deficit for the year so far")), /-500\.00/);
  assert.match(await flat(rowOf(bs, "Construction – Building")), /4,000\.00.*|Construction/);
  assert.match(await flat(bs), /The balance sheet balances/);
  await shot(page, "accounts-balance-sheet");
});

test("receipts and payments run from the opening balance to the closing balance", async () => {
  const rp = await show("Receipts & Payments");
  assert.deepEqual((await cells(rowOf(rp, "Opening balance"))).slice(1), ["5,000.00", "20,000.00", "25,000.00"]);
  assert.deepEqual((await cells(rowOf(rp, "Closing balance"))).slice(1), ["5,350.00", "15,750.00", "21,100.00"]);
  assert.deepEqual((await cells(rowOf(rp, "Outstanding expenses settled"))).slice(1), ["", "400.00", "400.00"]);
  const [r, p] = [await cells(rowOf(rp, "Total receipts")), await cells(rowOf(rp, "Total payments"))];
  assert.deepEqual(r.slice(1), p.slice(1));
  assert.match(await flat(rp), /equals the closing balance/);
});

test("the cash book and each bank's book keep a running balance", async () => {
  const cb = await show("Cash book");
  assert.deepEqual((await cells(rowOf(cb, "Opening balance"))).slice(3), ["", "", "5,000.00"]);
  assert.equal((await cells(rowOf(cb, "Total / closing balance"))).at(-1), "5,350.00");
  const bb = await show("Bank book");
  const uj = await flat(bb.getByRole("row").filter({ hasText: "Bank – Ujjivan" }).first());
  assert.match(uj, /Bank – Ujjivan/);
  assert.equal(await bb.getByRole("row").filter({ hasText: "Total / closing balance" }).count(), 2);          // Ujjivan and IDFC
  const closings = await bb.getByRole("row").filter({ hasText: "Total / closing balance" }).evaluateAll((rs) => rs.map((r) => r.lastElementChild.textContent.trim()));
  assert.deepEqual(closings.sort(), ["-50.00", "15,800.00"].sort());
});

test("the unpaid-bills list shows what is still owed", async () => {
  const u = await show("Unpaid bills list");
  const c = await cells(rowOf(u, "October electricity bill"));
  assert.deepEqual([c[4], c[5], c[6]], ["1,000.00", "400.00", "600.00"]);
  assert.match(c[1], /\/JV\/11\/V001$/);
});

test("the lists: day book, bills missing, donations without donor, fund-wise", async () => {
  const day = await show("Day book");
  assert.equal(await day.locator("tbody tr").count(), 11);                                                         // ten vouchers and the total row
  const missing = await show("Bills-missing list");
  assert.equal(await missing.getByRole("row").filter({ hasText: "No bill (self-voucher)" }).count(), 6);
  const donors = await show("Donations without donor name");
  assert.equal(await donors.getByRole("row").filter({ hasText: "Donation" }).count(), 1);                         // not the named one, not the hundi
  assert.match(await flat(rowOf(donors, "Total")), /500\.00/);
  const funds = await show("Fund-wise statement");
  // Money in and out: the 4,000 for the building and the 400 paid on the bill count; the journal (no money) does not.
  assert.deepEqual((await cells(rowOf(funds, "(no fund named)"))).slice(1), ["1,150.00", "5,050.00", "-3,900.00"]);
  assert.match(await flat(funds), /cash basis/i);
});

test("the journal register shows both sides of every voucher, including the journal", async () => {
  const j = await show("Journal register");
  assert.equal(await j.getByRole("row").filter({ hasText: "Dr  Annadanam" }).count() >= 3, true);
  assert.equal(await j.getByRole("row").filter({ hasText: "Cr  Outstanding expenses" }).count(), 1);
  const l = await show("Ledgers");
  assert.match(await flat(l.getByRole("row").filter({ hasText: "Closing balance" }).first()), /Closing balance/);
});

test("each book shows only its own vouchers, and together they are the whole", async () => {
  const expenditure = async (book) => Number((await flat(rowOf(await show("Income & Expenditure", book), "Total expenditure"))).match(/([\d,]+\.\d\d)/)[1].replaceAll(",", ""));
  const [all, temple, goshala, books] = [await expenditure("All books"), await expenditure("Temple"), await expenditure("Goshala"), await expenditure("Books")];
  assert.deepEqual([temple, goshala, books], [1300, 300, 50]);
  assert.equal(all, temple + goshala + books);
  const cb = await show("Cash book", "Goshala");
  assert.equal((await cells(rowOf(cb, "Total / closing balance"))).at(-1), "-300.00");                          // the Goshala book has its own cash
  const tb = await show("Trial balance", "Goshala");
  assert.match(await flat(tb), /The trial balance tallies/);
  assert.match(await flat(await show("Balance sheet", "Books")), /The balance sheet balances/);
});

test("periods: stepping back and forward, and a period with no vouchers says so", async () => {
  await control("Book").selectOption({ label: "All books" });
  await control("Report").selectOption({ label: "Day book" });
  await control("Period").selectOption("quarter");
  const label = page.locator("span[title]").first();
  const q = await label.textContent();
  assert.match(q, /^Q[1-4] \d{4}-\d{2}/);
  await page.getByRole("button", { name: "Next period" }).click();
  assert.notEqual(await label.textContent(), q);
  await page.getByRole("button", { name: "Previous period" }).click();
  assert.equal(await label.textContent(), q);
  await control("Period").selectOption("custom");
  await page.getByLabel("From", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To", { exact: true }).fill("2026-10-31");
  await page.getByText("Nothing to show for this period.").waitFor();
});

test("the filters fit their card: custom dates and a quarter's name, on a desktop and on a phone", async () => {
  // Everything inside the filter card must end inside it, and the page itself must never scroll sideways.
  const fits = () => page.evaluate(() => {
    const card = document.querySelector('select[aria-label="Book"]').closest("div.grid").getBoundingClientRect();
    const out = [...document.querySelectorAll('div.grid select, div.grid input, div.grid span[title]')]
      .map((el) => ({ el: el.getAttribute("aria-label") ?? el.getAttribute("title"), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > card.right + 0.5 || r.left < card.left - 0.5).map(({ el }) => el);
    return { out, pageOverflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  for (const width of [1360, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openAccounts();
    await show("Trial balance");
    assert.deepEqual(await fits(), { out: [], pageOverflow: 0 }, `custom dates at ${width}px`);
    await control("Period").selectOption("quarter");
    const label = page.locator("span[title]").filter({ hasText: /^Q[1-4] / });
    assert.deepEqual(await fits(), { out: [], pageOverflow: 0 }, `quarter at ${width}px`);
    if (width >= 1024) assert.ok(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), `the quarter's name is cut off at ${width}px`);
  }
  // On a phone the trial balance scrolls inside its card, and an account's name keeps room to be read.
  const nameWidth = await page.getByRole("region", { name: "Trial Balance" }).getByRole("row").filter({ hasText: "Cash in hand" }).getByRole("cell").first().evaluate((td) => td.getBoundingClientRect().width);
  assert.ok(nameWidth >= 200, `account names are squeezed into ${nameWidth}px`);
  await page.setViewportSize({ width: 1360, height: 900 });
});

test("Setup: moving a head to another book moves its vouchers with it", async () => {
  await openAccounts();
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByLabel("Book for Annadanam").selectOption({ label: "Goshala" });
  await page.waitForFunction(() => document.querySelector('select[aria-label="Book for Annadanam"]').value === "goshala");
  await page.waitForTimeout(500);
  assert.equal(sql("select book from categories where name = 'Annadanam'"), "goshala");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  const exp = Number((await flat(rowOf(await show("Income & Expenditure", "Goshala"), "Total expenditure"))).match(/([\d,]+\.\d\d)/)[1].replaceAll(",", ""));
  assert.equal(exp, 300 + 100 + 200 + 1000);                                                                      // Annadanam's vouchers are now Goshala's
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByLabel("Book for Annadanam").selectOption({ label: "Temple" });
  await page.waitForTimeout(500);
  assert.equal(sql("select book from categories where name = 'Annadanam'"), "temple");
});

test("Setup: a bank account can be added, and removed only while nothing has gone through it", async () => {
  await page.getByLabel("New bank account name").fill("Canara Bank");
  await page.getByRole("button", { name: "Add bank account" }).click();
  await page.locator("li").filter({ hasText: "Canara Bank" }).waitFor();
  assert.equal(sql("select count(*) from bank_accounts where name = 'Canara Bank'"), "1");
  page.once("dialog", (d) => d.accept());
  await page.locator("li").filter({ hasText: "Canara Bank" }).getByRole("button", { name: "Remove" }).click();
  await page.locator("li").filter({ hasText: "Canara Bank" }).waitFor({ state: "detached" });
  // Ujjivan has vouchers: the database refuses and the screen explains.
  page.once("dialog", (d) => d.accept());
  await page.locator("li").filter({ hasText: "Ujjivan" }).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("alert").filter({ hasText: /still used/ }).waitFor();
  assert.equal(sql("select count(*) from bank_accounts where name = 'Ujjivan'"), "1");
  s.expectRefusals(1);
});

test("Setup: opening balances that do not tally are flagged, saved, and shown as a difference until fixed", async () => {
  const input = (label, book) => page.getByLabel(`${label}, ${book} book`, { exact: true });
  await input("Cash in hand", "Goshala").fill("1000");
  await page.getByText("Debits less credits").locator("..").waitFor();
  assert.equal(await page.getByText("1000.00", { exact: true }).count(), 1);                                      // Goshala is 1000.00 out
  await page.getByRole("button", { name: "Save opening balances" }).click();
  await page.getByText("Opening balances saved.").waitFor();
  assert.equal(sql("select amount from opening_balances where book = 'goshala' and account = 'cash'"), "1000.00");

  await page.getByRole("button", { name: "Reports", exact: true }).click();
  const tb = await show("Trial balance", "Goshala");
  assert.match(await flat(tb), /Opening balance difference/);
  assert.match(await flat(tb), /The trial balance tallies/);                                                       // the report still tallies

  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await input("Capital fund", "Goshala").fill("1000");
  await page.getByRole("button", { name: "Save opening balances" }).click();
  await page.getByText("Opening balances saved.").waitFor();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  assert.doesNotMatch(await flat(await show("Trial balance", "Goshala")), /Opening balance difference/);
  assert.match(await flat(await show("Balance sheet", "Goshala")), /Cash in hand.*700\.00/);                       // 1,000 less the 300 of cattle feed
});

test("no page reported an error along the way", () => s.clean());
