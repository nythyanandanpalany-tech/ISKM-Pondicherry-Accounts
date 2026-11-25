# ExpenseFlow — ISKM Pondicherry Accounts

Workspace-based expense & income ledger for temples / seva groups, with **two images per entry** (bill + payment screenshot)
and **bank-statement reconciliation**. Runs on **Supabase** (Postgres + Auth + Storage) with the website on **Vercel**.
Both are used within their free plans, and neither needs a card.

Sample screens are in `docs/sample/`.

## How it hangs together

The browser talks to Postgres directly through Supabase's API. There is no backend of our own to host: every
permission rule lives in the database as **row level security** (`supabase/schema.sql`), so a signed-in sevak can only
ever read and write what their role in that workspace allows. The single server-side route is `/api/keepalive`, a
daily ping that stops Supabase pausing an idle free project.

## Try it locally

```bash
npm install
cp .env.local.example .env.local   # fill in the two Supabase values
npm run dev                        # http://localhost:3000
```

You need a Supabase project first (steps 1–4 below). The free plan allows two projects, so you can keep a separate
one for testing if you prefer not to develop against the live ledger.

## Go live

**1. Create the database.** https://supabase.com → new project. Pick a region near you (`ap-south-1`, Mumbai) and
save the database password it generates. No card is required.

**2. Create the tables.** Supabase → **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
That one file creates every table, view, function, trigger, the `receipts` storage bucket and all 41 row level
security policies. It is safe to run again later.

**3. Point email at Gmail.** Supabase's built-in sender is rate-limited and cannot use your own templates, so use
Gmail as the SMTP server:
- In the Google account that will send the mail, turn on 2-Step Verification, then create an **App password**
  (Google Account → Security → App passwords). It is a 16-character code; the account's normal password will not work.
- Supabase → **Authentication → Emails → SMTP Settings** → enable custom SMTP:
  host `smtp.gmail.com`, port `465`, username the full Gmail address, password the app password,
  sender email the same address, sender name e.g. `ISKM Pondicherry Accounts`.
- Gmail sends roughly 500 messages a day, which is far beyond what sign-ins need.

**4. Set the URLs.** Supabase → **Authentication → URL Configuration**: set *Site URL* to your Vercel address
(after step 6) and add `https://<your-app>.vercel.app/**` plus `http://localhost:3000/**` under *Redirect URLs*.
Magic links and confirmation links only work for addresses listed here.

**5. Copy the keys.** Supabase → **Project Settings → API Keys**: copy the *Project URL* and the **publishable** key
(`sb_publishable_...`) into `.env.local` (see `.env.local.example`). The *Legacy* tab's `anon` key works too, but
Supabase retires it at the end of 2026. Never put the *secret* or `service_role` key in this app — either bypasses
row level security entirely.

**6. Deploy the website.** Push this repo to GitHub, then https://vercel.com → **Add New → Project** → import it.
Next.js is detected automatically, so no build settings need changing. Add two **Environment Variables**:
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Deploy, then go back and finish step 4 with the
address Vercel gives you. Every later push to `main` redeploys.

**7. First sign-in.** Open the site → create an account → confirm the email → create a workspace (you become Owner)
→ add members in Settings by the email they signed up with.

**8. Check the photo rules once.** Sign in as someone who is *not* a member of a workspace and confirm they cannot
open its photos. The policies are written to prevent it; verifying it once on the live project is worth the minute.

## What it costs

Nothing, within these limits — and both services stop rather than bill you:

| | Free allowance | What it means here |
|---|---|---|
| Supabase database | 500 MB | Ledger rows are tiny text: hundreds of thousands of entries |
| Supabase storage | 1 GB | Photos are compressed to ~100 KB, so ~200 KB per entry ≈ 5,000 entries |
| Supabase egress | 5 GB/month | |
| Vercel Hobby | Non-commercial use | A temple/seva group qualifies; check their current terms |

A free Supabase project is paused after about a week with no activity. `/api/keepalive` is called daily by Vercel
Cron (`vercel.json`) to prevent that. If it is ever paused anyway, the dashboard has a **Resume project** button.
When photos approach 1 GB, use **Settings → Free up photo space** to download a ZIP of old photos and clear them
from the server.

## How it is built

- `lib/db.ts` — the one door to the backend. `from`, `storage` and `channel` are the Supabase client's own, so screens
  read like `db.from("entries").select().eq("workspace_id", id)`. `auth` and `rpc` are thin wrappers that add plain-language
  error messages, the "remember me" choice, and the password re-check that changing a password and deleting an account need.
- `lib/pdf.ts` — the daily report as a real PDF: vector text and shapes, page breaks, page numbers and metadata,
  so the file a devotee downloads can be searched, copied and printed sharp. It and jsPDF load only when someone
  clicks **Download PDF**, so they cost nothing on first paint. `docs/pdf-fonts.md` explains the embedded fonts.
- `supabase/schema.sql` — the whole backend: tables, the `store_stock` view, triggers that keep stock from going negative
  and log every entry change, the RPCs the screens call, and all permissions as row level security — roles
  (owner/admin/editor/viewer), "see only own entries", claim approval, chat privacy, photo access for members only.
- `supabase/migrations/` — the same thing split into ordered files, for the Supabase CLI. `schema.sql` is these concatenated.
  `20260101000005_vouchers.sql` adds the accounting module's numbered vouchers (below). On a project that is already
  running, paste just that file into the SQL Editor — it numbers the entries already made from 1 November 2026.
  `20260101000006_books.sql` adds what the books need on top of the vouchers: a book per head, bank accounts, the link from a
  payment to the unpaid bill it clears, and opening balances. Run it after the vouchers one; it changes no existing entry.
  `20260101000007_week_settlement.sql` adds the weekly settlement (cash counts and settled weeks). Run it after the books one.
  `20260101000008_roles.sql` adds users and roles — super admin, main accountant, entry user, full view (below). Run it last.
- `supabase/tests/` — the policy tests. `npm run test:rls` applies the schema to a scratch database on any PostgreSQL
  you point it at (`PGHOST`/`PGPORT`/`PGUSER`) and asserts that each role can do exactly what it should and nothing
  more — 244 checks, including voucher numbering, the books, the weekly settlement and users and roles. No Docker or Supabase account needed. See `supabase/tests/README.md`.

## Branding & look (ISKM Pondicherry)

The temple's identity lives in **one file**, `lib/brand.ts` — name, legal name, address, greeting and the maha-mantra.
Everything reads from it: the sidebar, the sign-in page, the PWA name (`app/manifest.ts`), printed payment vouchers and
the daily report letterhead. Handing the app to another centre means editing that file and nothing else.

- **Palette** — `app/globals.css`, sampled from the logo: the navy of its lettering for action and headings, the pink
  lotus as the accent, the lotus-leaf green for income, flag saffron for warnings, the gold of the domes for ornament,
  the logo's ivory for the canvas, and a navy "Vrindavan night" in dark mode. It works by re-pointing Tailwind's
  built-in scales (`indigo`, `slate`, `emerald`, `amber`, `red`, `sky`) at the temple palette, so every existing
  utility class across the app picks up the look with no per-component changes. Interactive colours clear WCAG AA
  (white on `indigo-600` = 10.8:1; `gold-ink` and `lotus-ink` rather than `gold` and `lotus` for small text on light).
- **Type** — Inter for the interface and every figure (tabular numerals matter in a ledger), Martel for headings and
  the wordmark, Tiro Devanagari Sanskrit for verses. All three are self-hosted by `next/font`; nothing is fetched from
  Google at run time. The report PDF carries its own three subsetted Noto faces in `public/fonts/` — a PDF cannot
  borrow the page's fonts, and the built-in ones have no ₹ and no `ā`/`ṣ`. See `docs/pdf-fonts.md`.
- **Logo** — `public/logo.jpeg`, the lotus and domes of Pudhuvai Vrindavanam Radha Krishna Temple. It appears in the
  sidebar, the mobile bar, the sign-in and password pages, printed vouchers, the daily report, and the letterhead of
  every PDF. The app never loads the full 1563 px original on screen: it uses round cut-outs (`public/logo-64/128/256.png`),
  a JPEG on white for paper and PDFs (`public/logo-print.jpg`), home-screen icons (`public/icon-192/512.png`,
  `public/apple-touch-icon.png`) and `app/favicon.ico` (cropped to the lotus, which is what still reads at 16 px). To
  change the logo, replace `public/logo.jpeg` and re-cut those files from it. The small pink eight-petalled lotus used
  for dividers and the sign-in watermark is still drawn as vector paths in `components/Brand.tsx`.
- **Verses** — `lib/verses.ts` holds twelve verses (Devanagari, IAST, plain-English rendering and citation) from the
  Gita, the Bhagavatam, Sri Isopanisad, Bhakti-rasamrta-sindhu and the Siksastaka, chosen for what they say about
  stewardship and seva. One appears on the Dashboard and the sign-in page each day — the same for everyone, rotating
  at midnight. The translations were written for this app rather than reproduced from a published edition, so they can
  be edited or replaced freely.

## Known limits (be aware)

- **The tests check the policies, not a live project.** `npm run test:rls` covers the database and photo policies
  against a stub of the pieces Supabase manages (`supabase/tests/stubs.sql`). Passing says the rules behave as
  intended; it is not proof the real project is configured right, so step 8 above is still worth doing once.
- Nothing tests Supabase Auth itself — sign-up, confirmation mail, magic links, password rules, rate limits.
- Photo links are signed URLs that expire after an hour, re-signed as needed by the browser.
- Editors could in principle change a store item's stock count without recording a move through the API (the triggers
  keep it ≥ 0 and consistent when recorded properly). Owners/admins see every change in History.
- Lists read every matching row into the browser (sorting and filters run client-side). Fine for a temple's volume;
  add pagination if it ever gets slow.
- Any signed-in user can check whether an email is registered (needed for "add member by email").
- A free Supabase project is paused after ~1 week of inactivity; the daily keep-alive ping prevents this.
- Donation receipts/letterhead are intentionally not built yet.

## Vouchers (accounting module, from 1 November 2026)

Every entry dated on or after the workspace's `vouchers_from` date (`workspaces.vouchers_from`, default
`2026-11-01`; set it to `NULL` to switch numbering off) is a numbered voucher, in the style the temple's paper
vouchers already use:

```
2026-2027 / BV / 11 / V018
financial year (April–March) · type · month of the entry date · serial
```

| Type | Meaning | Chosen from |
|---|---|---|
| `CV` | Cash Voucher | expense paid in **Cash** |
| `BV` | Bank Voucher | expense paid any other way (UPI, bank transfer, cheque, card, other) |
| `CR` | Cash Receipt | income received in **Cash** |
| `BR` | Bank Receipt | income received any other way |
| `JV` | Journal Voucher | an adjustment with no cash or bank movement — owners and admins only |

- The serial restarts every month, separately for each type. A database trigger issues it, so two people saving at
  the same moment never get the same number; the browser cannot choose or change one.
- Changing an entry's mode between cash and bank, or its date to another month or year, issues a number from the
  right series. The old number is never reused and stays in the entry's history.
- Deleting a voucher leaves a gap in the serial. That is deliberate (the history shows what was deleted).
- A **journal voucher** debits one head and credits another — a bill not yet paid (credits *Outstanding expenses*),
  an amount moved between heads, or a mistake corrected — with a required narration. A head that has journal
  postings cannot be deleted.
- An expense with no bill is a self-voucher and is marked **No bill** (derived: nothing attached and "Receipt / bill
  available?" answered No — a bill that is promised but not yet uploaded stays under *Bills missing*).
- `lib/voucher.ts` mirrors the numbering rules for the entry form's preview; `lib/tests/pure.test.mjs` and
  `supabase/tests/rls.test.sql` pin both to the same examples.

## Books and reports (Accounts)

**Accounts** in the sidebar (owners and admins) is the books: Journal → Ledger → Trial balance, accrual basis, financial
year April–March, for any date range — week, month, quarter, financial year or custom. Everything is worked out in the
browser from the numbered vouchers by `lib/accounts.ts`; `lib/sheets.ts` lays each report out once, and the screen, the
Excel workbook and the PDF all draw from that one layout, so a figure cannot differ between them.

How a voucher posts:

| Voucher | Debit | Credit |
|---|---|---|
| CV / BV (expense) | the head | Cash in hand / the bank account chosen |
| CR / BR (income) | Cash in hand / the bank account | the head |
| JV, bill not yet paid | the head | Outstanding expenses |
| JV, move or correct | one head | another head |
| a payment that *settles* an unpaid bill | Outstanding expenses | Cash / Bank |

That last row is what keeps accrual honest: choosing "this pays a bill already booked as unpaid" on the entry form clears the
liability instead of charging the expense a second time.

**Three separate books — Temple, Goshala, Books.** A head belongs to exactly one (Accounts → Setup). Gaushala heads default to
Goshala, Purchase of books to Books, everything else to Temple. A voucher, and the cash or bank leg of it, is kept in the book of
its head, so every book is self-contained and its trial balance tallies on its own; *All books* is their sum. A journal between
heads in two books is posted through an inter-book account on each side, which cancels in the combined view. Construction is a
section inside the Temple book (heads marked *Construction*); capital heads are assets, not expenses. No depreciation and no asset
register for now, and no month-locking.

Reports: trial balance, ledgers, journal register, cash book, bank book (one per bank account), bank reconciliation, income &
expenditure, balance sheet, receipts & payments, day book, fund-wise statement, bills-missing list, unpaid-bills list, donations
without donor name. **Auditor pack** makes all of them, for the chosen book and period, as one Excel workbook and one PDF.

Opening balances (Accounts → Setup) say where each account stood on the day the vouchers begin, including the April–October
totals of income and expense heads. If they do not tally, the gap shows as its own line instead of unbalancing every report.
From the second financial year the income and expense heads start afresh and the year's surplus moves into the capital fund.

## Users and roles

| Role | Can do |
|---|---|
| **Super admin** | Everything, in every workspace, whether or not they were added to it: edit and delete any entry, see every user, set everyone's role. |
| Owner / Admin | Everything inside their workspace, including editing and deleting entries. |
| **Main accountant** | Sees every entry, adds entries and journal vouchers, keeps the books (Accounts reports), bank statement, reconciliation and weekly settlement. Cannot edit or delete an entry, and cannot change Accounts → Setup. |
| **Entry user** | Adds entries and sees only their own. Cannot edit or delete, not even their own. |
| Viewer | Reads only. |
| **Full view** | A switch per member that lets an entry user or viewer see the whole workspace. |

Super admins have **Users & permissions** in the sidebar: the *Users* tab lists every account (from Supabase Auth: confirmed or
not, joined, last sign-in, and their role in each workspace); the *Permissions* tab sets a user's role in each workspace, full
view and download, and makes or unmakes super admins. Every change is logged with who made it (`role_log`), and the database
keeps two guard rails: there is always at least one super admin, and every workspace keeps an owner.

All of it is enforced in Postgres (`supabase/migrations/20260101000008_roles.sql`): `profiles.super_admin` cannot be written
from the browser, and the `admin_*` functions refuse anyone who is not a super admin.

**The first super admin** is whoever `SUPER_ADMIN_EMAIL` names in `.env`. Apply the roles migration, then run
`node --env-file=.env scripts/bootstrap-super-admin.mjs`: it sets that account's password to `SUPER_ADMIN_PASSWORD` (creating
the account, already confirmed, if needed) and marks it super admin. From then on, roles are managed in the app.

## Weekly settlement

**Weekly settlement** in the sidebar (owners and admins) lists every calendar week (Monday–Sunday) since the vouchers began. A
week is *settled* when all four checks pass:

| Check | Passes when |
|---|---|
| Bank matched | every bank voucher of the week is matched to a bank-statement row (Reconcile), and no statement row of the week is left without an entry |
| Cash counted | the cash in hand counted at the end of Sunday (all books together) equals the cash book |
| Trial balance tallies | every book's trial balance tallies for the week, and so do the opening balances |
| Bills attached | no expense of the week is "bill promised, not uploaded" (No-bill self-vouchers are allowed, and listed) |

The checks are worked out from the vouchers each time (`lib/settlement.ts`); only the cash count and the settling are stored, in
`week_settlements`, with who did it stamped by the database. A week can be settled from its Sunday. Settling locks nothing — there
is no month-locking — so an entry can still be added or corrected; a settled week whose vouchers or cash book then change says
*Settled — changed since*, and a new cash count reopens it.
