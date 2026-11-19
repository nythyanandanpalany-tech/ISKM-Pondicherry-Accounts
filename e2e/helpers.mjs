// Shared by the end-to-end tests: one Chromium for the file, a fresh signed-in page per test, and
// the small set of things a person does in this app (sign in, add an entry, open the ledger).
//
// Every page refuses to talk to the real Supabase: any request to *.supabase.co is aborted and
// fails the test, so these tests cannot touch live data even if the environment is wrong.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { PASSWORD } from "./fixtures.mjs";

export { reseed, sql } from "./stack.mjs";
export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export const launch = () => chromium.launch({ headless: true });

const IGNORED = [/WebSocket/i, /realtime/i, /favicon/i, /Failed to load resource/i, /Download the React DevTools/i, /\[HMR\]|\[Fast Refresh\]/i, /hydrat/i];

/** A fresh browser context (own cookies and storage), with the real-Supabase guard and error capture. */
export async function newSession(browser) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const problems = [];
  // The browser logs a refused request as a console error with no detail, so refusals are counted from the
  // responses instead. A test that provokes one says so with `expectRefusals(n)`; any other 4xx/5xx fails the run.
  const refused = []; let expected = 0;
  context.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/rest/v1/")) refused.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  await context.route(/supabase\.co/, (route) => { problems.push(`request to real Supabase: ${route.request().url()}`); return route.abort(); });
  // A first visit opens a product tour over everything; these tests are about the books, so start as a returning user.
  await context.addInitScript(() => { try { localStorage.setItem("ef_tour", "1"); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !ignored(m.text())) problems.push(`console error: ${m.text()}`); });
  return {
    context, page, problems, refused, close: () => context.close(),
    expectRefusals: (n = 1) => { expected += n; },
    clean: () => { assert.deepEqual(problems, [], "the page reported problems"); assert.equal(refused.length, expected, `unexpected refused requests: ${JSON.stringify(refused)}`); },
  };
}
const ignored = (text) => IGNORED.some((r) => r.test(text));

export async function login(page, user) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("Email").fill(user.email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${BASE}/app`);
  await page.getByRole("heading", { name: /Hare Krishna,/ }).waitFor();
}

export async function openLedger(page, { all = true } = {}) {
  await page.goto(`${BASE}/app/ledger`);
  await page.getByRole("heading", { name: "Ledger" }).waitFor();
  if (all) await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByText("Loading…").waitFor({ state: "detached" });
}

const radio = (scope, text) => scope.locator("label").filter({ hasText: new RegExp(`^${text}$`) });

/** Fill the Add entry form and save it. Returns the dialog's error text if the save was refused. */
export async function addEntry(page, o) {
  const { type = "expense", amount, date, category, mode = "Cash", bank, person, note, bill = false, settles } = o;
  await page.getByRole("button", { name: "+ Add entry" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("heading", { name: "Add entry" }).waitFor();
  if (type === "income") await radio(dlg, "Income").click();
  await dlg.getByLabel(/^Amount/).fill(String(amount));
  if (date) await dlg.getByLabel(/^Date/).fill(date);
  if (category) await dlg.getByLabel(type === "income" ? /^Income source/ : /^Category/).selectOption({ label: category });
  await radio(dlg, mode).click();
  if (bank) await dlg.getByLabel(/^Bank account/).selectOption({ label: bank });
  if (person) await dlg.getByLabel(type === "expense" ? /^Who paid/ : /^Received from/).selectOption({ label: person });
  if (note) await dlg.getByLabel(/^Note/).fill(note);
  if (bill) await dlg.locator("fieldset").filter({ hasText: "Receipt / bill available?" }).locator("label").filter({ hasText: /^Yes$/ }).click();
  if (settles) {
    // The bills are fetched when the form opens; wait for the option instead of racing it.
    const sel = dlg.getByLabel(/pay a bill that was already booked/);
    const option = sel.locator("option").filter({ hasText: settles }).first();
    await option.waitFor({ state: "attached" });
    await sel.selectOption(await option.getAttribute("value"));
  }
  return dlg;
}

export async function saveEntry(page, dlg, { expectError = false } = {}) {
  await dlg.getByRole("button", { name: /^(Add expense|Add income|Save changes)$/ }).click();
  if (expectError) { const alert = dlg.getByRole("alert"); await alert.waitFor(); return (await alert.textContent()).trim(); }
  await page.getByRole("dialog").waitFor({ state: "detached" });
  return null;
}

/** The ledger row that carries this voucher number. */
export const rowFor = (page, voucherNo) => page.locator("tbody tr").filter({ hasText: voucherNo });

export async function newEntry(page, o) {
  const dlg = await addEntry(page, o);
  return saveEntry(page, dlg);
}

/** A screenshot for whoever reviews the run; never part of an assertion. */
export async function shot(page, name) {
  const dir = process.env.E2E_SHOTS ?? "e2e/.artifacts";
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}
