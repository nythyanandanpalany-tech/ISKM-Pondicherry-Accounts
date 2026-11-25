# End-to-end tests (Playwright + Chromium)

These drive the real app in Chromium against a real PostgreSQL that has the actual schema, triggers and
row level security — nothing is mocked except Supabase Auth's login endpoint (`gateway.mjs` signs the
same kind of JWT it would). They never touch the live Supabase project: any request to `*.supabase.co`
is aborted and fails the run, and the app is built from a throwaway copy with no `.env` files.

```bash
PGHOST=127.0.0.1 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest npm run test:e2e
npm run test:e2e journal          # only files whose name contains "journal"
npm run e2e:serve                 # leave the stack up and poke at http://localhost:3100
```

Needs a PostgreSQL you may create databases on (the `ef_e2e` database is dropped and recreated), the
[PostgREST](https://github.com/PostgREST/postgrest/releases) binary, and Playwright's Chromium
(`npx playwright install chromium`).

On macOS the PostgREST release binary looks for Homebrew's `libpq`; if it is not at
`/opt/homebrew/opt/libpq`, point `DYLD_FALLBACK_LIBRARY_PATH` at a copy (postgresql@18 ships one in
`lib/postgresql`) and run `node e2e/run.mjs` directly — `npm run` goes through `/bin/sh`, which drops
`DYLD_*` variables, and PostgREST then never comes up. Test people: `owner@e2e.test`, `admin@e2e.test`, `editor@e2e.test`, `accountant@e2e.test`, `super@e2e.test`, `newcomer@e2e.test`,
password `e2e-Password-1`.

| File | Covers |
|---|---|
| `vouchers.test.mjs` | CV/BV/CR/BR numbering, serials, month and financial-year rollover, cash→UPI renumbering with history, bank account required, No-bill flag and filter, search by number |
| `journal.test.mjs` | Journal vouchers and their validation, paying an unpaid bill in parts, over-payment refused, journal with payments cannot be deleted, editors cannot journal or open the books (screen and database) |
| `accounts.test.mjs` | Every report against hand-worked figures (`scenario.mjs`), each book separately and together, periods, filters that fit their card on desktop and phone, Setup: heads→books, bank accounts, opening balances |
| `settlement.test.mjs` | Weekly settlement: every week listed, bank matched once the statement is matched (an unmatched statement row keeps it open), a wrong cash count says by how much, settling records who did it, a later entry marks the week changed, undo, editors kept out |
| `roles.test.mjs` | Users and roles: a super admin in no workspace sees all users and workspaces, gives roles, full view and super admin (stored and logged); entry users see only their own and cannot edit or delete (screen and database); the main accountant sees everything and journals but cannot edit; owners cannot reach the super admin's screen; the last super admin and a workspace's only owner are protected |
| `daily-report.test.mjs` | The Mangalarti report: message text and order (totals, heads, donors) per book, the preview equals what is sent, entry users kept out, Find my group (a stand-in Telegram), the token kept out of the browser and API, test message, send now, the 3:30 job sends yesterday once and only books with entries, Telegram's refusals shown, switching off |
| `chart-logs.test.mjs` | A second super admin has equal powers but cannot touch the main one (screen and database); the main super admin's account cannot be deleted; Logs shows who added and who changed an entry, with old → new, filters, owners limited to their workspace; the chart as a draft for owners, approved by the super admin into the right books, an old head merged with its voucher number kept |
| `exports.test.mjs` | The Excel and PDF downloads open and agree with the screen; the auditor pack has all 14 reports, for all books or one |
