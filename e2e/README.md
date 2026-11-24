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
`DYLD_*` variables, and PostgREST then never comes up. Test people: `owner@e2e.test`, `admin@e2e.test`, `editor@e2e.test`,
password `e2e-Password-1`.

| File | Covers |
|---|---|
| `vouchers.test.mjs` | CV/BV/CR/BR numbering, serials, month and financial-year rollover, cash→UPI renumbering with history, bank account required, No-bill flag and filter, search by number |
| `journal.test.mjs` | Journal vouchers and their validation, paying an unpaid bill in parts, over-payment refused, journal with payments cannot be deleted, editors cannot journal or open the books (screen and database) |
| `accounts.test.mjs` | Every report against hand-worked figures (`scenario.mjs`), each book separately and together, periods, filters that fit their card on desktop and phone, Setup: heads→books, bank accounts, opening balances |
| `settlement.test.mjs` | Weekly settlement: every week listed, bank matched once the statement is matched (an unmatched statement row keeps it open), a wrong cash count says by how much, settling records who did it, a later entry marks the week changed, undo, editors kept out |
| `exports.test.mjs` | The Excel and PDF downloads open and agree with the screen; the auditor pack has all 14 reports, for all books or one |
