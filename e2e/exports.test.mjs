// End to end: the Excel and PDF files really download, open, and say the same thing as the screen.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { launch, newSession, login, reseed, shot, BASE } from "./helpers.mjs";
import { loadScenario, RANGE } from "./scenario.mjs";
import { USERS } from "./fixtures.mjs";

const XLSX = createRequire(import.meta.url)("xlsx");
let browser, s, page;
before(async () => {
  reseed(); loadScenario();
  browser = await launch(); s = await newSession(browser); page = s.page;
  await login(page, USERS.owner);
  await page.goto(`${BASE}/app/accounts`);
  await page.getByRole("heading", { name: "Accounts" }).waitFor();
  await page.getByLabel("Period", { exact: true }).selectOption("custom");
  await page.getByLabel("From", { exact: true }).fill(RANGE.from);
  await page.getByLabel("To", { exact: true }).fill(RANGE.to);
  await page.getByText("Loading the books…").waitFor({ state: "detached" });
});
after(async () => { await s?.close(); await browser?.close(); });

/** Click, and collect the n files the browser downloads as a result. */
async function downloads(n, click) {
  const got = [];
  const on = (d) => got.push(d);
  page.on("download", on);
  await click();
  const t0 = Date.now();
  while (got.length < n && Date.now() - t0 < 60000) await page.waitForTimeout(200);
  page.off("download", on);
  assert.equal(got.length, n, `expected ${n} download(s), got ${got.length}`);
  return Promise.all(got.map(async (d) => ({ name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) })));
}
const pick = (report, book = "All books") => Promise.all([
  page.getByLabel("Book", { exact: true }).selectOption({ label: book }),
  page.getByLabel("Report", { exact: true }).selectOption({ label: report }),
]);
const pages = (pdf) => (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
const numbers = (ws) => Object.keys(ws).filter((k) => !k.startsWith("!") && ws[k].t === "n").map((k) => ws[k].v);

test("a report downloads as an Excel file that says what the screen says", async () => {
  await pick("Trial balance");
  const region = page.getByRole("region", { name: "Trial Balance" });
  await region.waitFor();
  const [x] = await downloads(1, () => page.getByRole("button", { name: "Excel", exact: true }).click());
  assert.equal(x.name, "trial-balance-e2e-temple-all-2026-11-01_2026-11-30.xlsx");
  const wb = XLSX.read(x.bytes, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["Trial Balance"]);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Trial Balance"], { header: 1, defval: null });
  assert.match(rows[0][0], /International Sri Krishna Mandir/);
  assert.equal(rows[1][0], "Trial Balance");
  const total = rows.find((r) => r[0] === "Total");
  assert.equal(total[1], total[2]); assert.equal(total[5], total[6]);                       // real numbers, and they tally
  const screen = (await region.getByRole("row").filter({ hasText: "Total" }).last().getByRole("cell").allTextContents()).map((c) => c.trim());
  assert.equal(screen[5], total[5].toLocaleString("en-IN", { minimumFractionDigits: 2 }));  // the file and the screen agree to the paisa
  assert.ok(numbers(wb.Sheets["Trial Balance"]).length > 8);
});

test("a report downloads as a PDF", async () => {
  const [p] = await downloads(1, () => page.getByRole("button", { name: "PDF", exact: true }).click());
  assert.equal(p.name, "trial-balance-e2e-temple-all-2026-11-01_2026-11-30.pdf");
  assert.equal(p.bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(p.bytes.length > 20000, "the embedded fonts should be in the file");
  assert.ok(pages(p.bytes) >= 1);
});

test("the auditor pack is one Excel workbook and one PDF with every report in it", async () => {
  await pick("Trial balance");
  const files = await downloads(2, () => page.getByRole("button", { name: "Auditor pack (Excel + PDF)" }).click());
  const xlsx = files.find((f) => f.name.endsWith(".xlsx")), pdf = files.find((f) => f.name.endsWith(".pdf"));
  assert.ok(xlsx && pdf, `got ${files.map((f) => f.name)}`);
  assert.equal(xlsx.name, "auditor-pack-e2e-temple-all-2026-11-01_2026-11-30.xlsx");
  const wb = XLSX.read(xlsx.bytes, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["Trial Balance", "Ledgers", "Journal", "Cash Book", "Bank Book", "Bank Recon", "Income & Expenditure", "Balance Sheet", "Receipts & Payments", "Day Book", "Fund-wise", "Bills Missing", "Unpaid Bills", "No Donor"]);
  const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null });
  const find = (n, label) => sheet(n).find((r) => r[0] === label || r[2] === label);
  assert.equal(find("Income & Expenditure", "Total income")[1], 1150);
  assert.equal(find("Income & Expenditure", "Total expenditure")[1], 1650);
  assert.equal(find("Balance Sheet", "Total assets")[1], 25100);
  assert.equal(find("Balance Sheet", "Total liabilities & capital")[1], 25100);
  assert.deepEqual(find("Unpaid Bills", "Total").slice(4, 7), [1000, 400, 600]);
  assert.equal(find("Day Book", "Total")[3], 1150);                                            // the day book's income column agrees with the I&E
  assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pages(pdf.bytes) >= 14, `each of the 14 reports starts a page, got ${pages(pdf.bytes)}`);
  await shot(page, "accounts-after-pack");
});

test("the pack for one book contains only that book", async () => {
  await pick("Trial balance", "Goshala");
  const files = await downloads(2, () => page.getByRole("button", { name: "Auditor pack (Excel + PDF)" }).click());
  const xlsx = files.find((f) => f.name.endsWith(".xlsx"));
  assert.match(xlsx.name, /-goshala-/);
  const wb = XLSX.read(xlsx.bytes, { type: "buffer" });
  const ie = XLSX.utils.sheet_to_json(wb.Sheets["Income & Expenditure"], { header: 1, defval: null });
  assert.equal(ie.find((r) => r[0] === "Total expenditure")[1], 300);
  assert.match(ie[2][0], /Goshala/);
  const day = XLSX.utils.sheet_to_json(wb.Sheets["Day Book"], { header: 1, defval: null });
  assert.equal(day.filter((r) => typeof r[1] === "string" && r[1].startsWith("2026-2027/")).length, 1);   // the one cattle-feed voucher
});

test("no page reported an error along the way", () => s.clean());
