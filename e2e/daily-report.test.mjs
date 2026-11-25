// End to end: the Mangalarti daily report (change 3E). The preview on screen, the 3:30 job, "send now" and the test
// message all go through the real database functions; pg_net is the test stand-in that records each request to
// Telegram instead of sending it, and a test plays Telegram's reply by writing net._http_response.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, newSession, login, reseed, sql, shot, BASE } from "./helpers.mjs";
import { USERS, WS, CAT, PERSON, TELEGRAM_TOKEN } from "./fixtures.mjs";

const DAY = "2026-11-15";
let browser, o, page;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const textOf = (book, day = DAY) => sql(`select coalesce(_daily_report_text('${WS}', '${day}', '${book}'), '(none)')`);
const queued = () => Number(sql("select count(*) from net.http_request_queue"));
const sent = (fromId) => sql(`select string_agg(body->>'text', E'\\n=====\\n' order by id) from net.http_request_queue where id > ${fromId}`);
const lastId = () => Number(sql("select coalesce(max(id), 0) from net.http_request_queue"));
const entry = (type, day, amount, cat, person, by = USERS.owner.id) =>
  `('${WS}', '${type}', '${day}', ${amount}, '${cat}', ${person ? q(person) : "null"}, 'Cash', '${by}')`;

before(async () => {
  reseed();
  sql(`insert into entries (workspace_id, type, entry_date, amount, category_id, person_id, payment_mode, created_by) values
    ${entry("income", DAY, 5000, CAT.donation, PERSON.ramesh)},
    ${entry("income", DAY, 1500, CAT.hundi, null)},
    ${entry("income", DAY, 2000, CAT.goshalaDonation, PERSON.sita)},
    ${entry("expense", DAY, 1200, CAT.annadanam, null, USERS.editor.id)},
    ${entry("expense", DAY, 800, CAT.gaushala, null)},
    ${entry("expense", DAY, 450.5, CAT.books, null)}`);
  browser = await launch();
  o = await newSession(browser); page = o.page;
  await login(page, USERS.owner);
});
after(async () => { await o?.close(); await browser?.close(); });

async function openReport(p, day = DAY) {
  await p.getByRole("link", { name: "Daily report", exact: true }).first().click();
  await p.getByRole("heading", { name: "Daily report", exact: true }).waitFor();
  await p.getByLabel("Report date").fill(day);
  await p.getByRole("heading", { name: new RegExp(`Messages for ${day.split("-").reverse().join("/")}`) }).waitFor();
  await p.getByText("Loading…").waitFor({ state: "detached" });
}
const messages = (p) => p.getByRole("region", { name: "Messages" }).locator("article");
const status = async (p = page) => { const s = p.getByRole("status"); await s.waitFor(); return (await s.textContent()).trim(); };

test("the message reads in the agreed order: totals, then each head, then donors", () => {
  const all = textOf("all");
  assert.equal(all, [
    "Hare Krishna 🙏", "E2E Temple — Daily report · All books", "Sunday, 15 Nov 2026", "",
    "Total income: ₹8,500", "Total expense: ₹2,450.50", "",
    "Income by head", "• Donation: ₹5,000", "• Goshala donation: ₹2,000", "• Hundi: ₹1,500", "",
    "Expense by head", "• Annadanam: ₹1,200", "• Gaushala: ₹800", "• Purchase of books: ₹450.50", "",
    "Donors", "• Ramesh: ₹5,000", "• Sita Devi: ₹2,000", "• Name not recorded: ₹1,500",
  ].join("\n"));
  assert.match(textOf("goshala"), /· Goshala\n[\s\S]*Total income: ₹2,000\nTotal expense: ₹800[\s\S]*• Sita Devi: ₹2,000$/);
  assert.match(textOf("books"), /· Books\n[\s\S]*Total income: ₹0\nTotal expense: ₹450.50\n\nExpense by head\n• Purchase of books: ₹450.50$/);
  assert.equal(textOf("all", "2026-11-16"), "(none)", "a day with no entries sends nothing");
});

test("the main accountant sees exactly what will be sent, but not the Telegram settings", async () => {
  const a = await newSession(browser);
  try {
    await login(a.page, USERS.accountant);
    await openReport(a.page);
    assert.equal(await messages(a.page).count(), 4);
    const shown = await messages(a.page).locator("pre").allTextContents();
    assert.deepEqual(shown, ["all", "temple", "goshala", "books"].map((b) => textOf(b)));
    assert.equal(await a.page.getByRole("region", { name: "Telegram" }).count(), 0);
    await a.page.getByRole("button", { name: "Next day" }).click();
    await a.page.getByText("No entries on this day, so nothing is sent.").waitFor();
    await shot(a.page, "daily-report-accountant");
    a.clean();
  } finally { await a.close(); }
});

test("an entry user has no Daily report: it shows everyone's money", async () => {
  const e = await newSession(browser);
  try {
    await login(e.page, USERS.editor);
    assert.equal(await e.page.getByRole("link", { name: "Daily report", exact: true }).count(), 0);
    await e.page.goto(`${BASE}/app/daily-report`);
    await e.page.getByText("Only owners, admins and the main accountant can see the daily report.").waitFor();
    e.clean();
  } finally { await e.close(); }
});

test("it cannot be switched on before the bot is set up", async () => {
  await openReport(page);
  const tg = page.getByRole("region", { name: "Telegram" });
  assert.equal((await tg.getByTestId("report-state").textContent()).trim(), "Off");
  await tg.getByLabel(/Send automatically every day/).check();
  await tg.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").getByText(/Add the bot token and the group chat id/).waitFor();
  o.expectRefusals(1);
  assert.equal(sql(`select count(*) from report_settings where workspace_id = '${WS}' and enabled`), "0");
});

test("Find my group: a wrong token is refused, the right one finds the group", async () => {
  const tg = page.getByRole("region", { name: "Telegram" });
  await tg.getByLabel("Bot token").fill("123456789:AAEwrongwrongwrongwrongwrongwrongwrong");
  await tg.getByRole("button", { name: "Find my group" }).click();
  await page.getByRole("alert").getByText("Telegram does not recognise this bot token.").waitFor();
  await tg.getByLabel("Bot token").fill(TELEGRAM_TOKEN);
  await tg.getByRole("button", { name: "Find my group" }).click();
  assert.equal(await status(), "Found “ISKM Pondicherry Reporting”.");
  assert.equal(await tg.getByPlaceholder("-1001234567890").inputValue(), "-1009876543210");
});

test("saving keeps the token in the secret store; the browser only ever sees a hint of it", async () => {
  const tg = page.getByRole("region", { name: "Telegram" });
  await tg.getByLabel(/Send automatically every day/).check();
  await tg.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal(await status(), "Saved. The report will go out every day at 3:30 AM.");
  assert.equal(sql(`select enabled || ' ' || telegram_chat_id from report_settings where workspace_id = '${WS}'`), "true -1009876543210");
  assert.equal(sql(`select telegram_token from private.report_secrets where workspace_id = '${WS}'`), TELEGRAM_TOKEN);
  await page.reload();
  await page.getByRole("heading", { name: "Daily report", exact: true }).waitFor();
  const tgr = page.getByRole("region", { name: "Telegram" });
  await tgr.getByTestId("report-state").getByText("On — sends daily at 3:30 AM").waitFor();
  assert.equal(await tgr.getByLabel("Bot token").inputValue(), "");
  assert.match(await tgr.getByLabel("Bot token").getAttribute("placeholder"), /Saved \(123456789:…stuv\)/);
  assert.ok(!(await page.content()).includes(TELEGRAM_TOKEN), "the token must never reach the page");
  // Not even a hand-made request can read it.
  const leaked = await page.evaluate(async () => {
    const raw = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    const token = JSON.parse(localStorage.getItem(raw)).access_token;
    const h = { Authorization: `Bearer ${token}`, apikey: "x" };
    const a = await fetch("http://127.0.0.1:54321/rest/v1/report_secrets", { headers: h });
    const b = await fetch("http://127.0.0.1:54321/rest/v1/report_settings", { headers: h });
    return [a.status, await b.text()];
  });
  assert.ok(leaked[0] >= 400, "the secrets table is not reachable through the API");
  assert.ok(!leaked[1].includes("AAE"), "the settings table holds no token");
  o.expectRefusals(1);
  await shot(page, "daily-report-owner");
});

test("a test message goes to the group, and the log shows when Telegram confirms it", async () => {
  const before = lastId();
  const tg = page.getByRole("region", { name: "Telegram" });
  await tg.getByRole("button", { name: "Send a test message" }).click();
  assert.equal(await status(), "Test message sent to Telegram.");
  const [url, chat, text] = sql(`select url || '|' || (body->>'chat_id') || '|' || (body->>'text') from net.http_request_queue where id > ${before}`).split("|");
  assert.equal(url, `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`);
  assert.equal(chat, "-1009876543210");
  assert.match(text, /the daily report is connected/);
  const sentLog = page.getByRole("region", { name: "Sent" });
  await sentLog.getByText("Waiting for Telegram…").first().waitFor();
  sql(`insert into net._http_response (id, status_code, content) values (${before + 1}, 200, '{"ok":true}')`);
  await page.reload();
  await page.getByRole("region", { name: "Sent" }).getByText("✓ Delivered").waitFor();
});

test("'Send this day now' sends the four messages exactly as previewed", async () => {
  const before = lastId();
  await openReport(page);
  await page.getByRole("button", { name: "Send 15/11/2026 now" }).click();
  assert.equal(await status(), "Sent 4 messages for 15/11/2026.");
  await shot(page, "daily-report-messages");
  assert.equal(sent(before), ["all", "temple", "goshala", "books"].map((b) => textOf(b)).join("\n=====\n"));
});

test("the 3:30 job sends yesterday once, only the books that had entries, and shows Telegram's refusals", async () => {
  assert.equal(sql("select schedule || ' ' || command from cron.job where jobname = 'daily-report-mangalarti'"), "0 22 * * * select public.run_daily_reports()");
  const yesterday = sql("select ((now() at time zone 'Asia/Kolkata')::date - 1)::text");
  sql(`insert into entries (workspace_id, type, entry_date, amount, category_id, person_id, payment_mode, created_by) values
    ${entry("income", yesterday, 1001, CAT.donation, PERSON.ramesh)}`);
  const before = lastId();
  assert.equal(sql("select run_daily_reports()"), "2", "all books + Temple; Goshala and Books had nothing");
  assert.equal(sent(before), [textOf("all", yesterday), textOf("temple", yesterday)].join("\n=====\n"));
  assert.match(textOf("all", yesterday), /Total income: ₹1,001\nTotal expense: ₹0/);
  assert.equal(sql("select run_daily_reports()"), "0", "never twice");

  sql(`insert into net._http_response (id, status_code, content) values
    (${before + 1}, 200, '{"ok":true}'), (${before + 2}, 403, '{"ok":false,"description":"Forbidden: bot was kicked from the group chat"}')`);
  await page.reload();
  const log = page.getByRole("region", { name: "Sent" });
  await log.getByText("✗ Forbidden: bot was kicked from the group chat").waitFor();
  const rows = await log.locator("tbody tr").filter({ hasText: "3:30 AM" }).allTextContents();
  assert.equal(rows.length, 2);
});

test("switched off, the 3:30 job sends nothing; the token can be removed", async () => {
  const tg = page.getByRole("region", { name: "Telegram" });
  await tg.getByLabel(/Send automatically every day/).uncheck();
  await tg.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal(await status(), "Saved. The daily report is switched off.");
  sql("delete from report_deliveries where kind = 'scheduled'");
  assert.equal(sql("select run_daily_reports()"), "0");
  await tg.getByRole("button", { name: "Remove token" }).click();
  assert.equal(await status(), "Bot token removed; the daily report is off.");
  assert.equal(sql(`select count(*) from private.report_secrets where workspace_id = '${WS}'`), "0");
  assert.equal(queued() > 0, true);
});

test("no page reported an error along the way", () => o.clean());
