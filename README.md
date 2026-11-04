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
- `supabase/tests/` — the policy tests. `npm run test:rls` applies the schema to a scratch database on any PostgreSQL
  you point it at (`PGHOST`/`PGPORT`/`PGUSER`) and asserts that each role can do exactly what it should and nothing
  more — 55 checks. No Docker or Supabase account needed. See `supabase/tests/README.md`.

## Branding & look (ISKM Pondicherry)

The temple's identity lives in **one file**, `lib/brand.ts` — name, legal name, address, greeting and the maha-mantra.
Everything reads from it: the sidebar, the sign-in page, the PWA name (`app/manifest.ts`), printed payment vouchers and
the daily report letterhead. Handing the app to another centre means editing that file and nothing else.

- **Palette** — `app/globals.css`. Kumkuma saffron for action, a sandalwood-cream canvas, tulsi green for income,
  marigold for warnings, temple gold for ornament, and "Vrindavan night" in dark mode. It works by re-pointing
  Tailwind's built-in scales (`indigo`, `slate`, `emerald`, `amber`, `red`, `sky`) at the temple palette, so every
  existing utility class across the app picks up the look with no per-component changes. Interactive colours clear
  WCAG AA (white on `indigo-600` = 4.9:1; `gold-ink` rather than `gold` for small text on light).
- **Type** — Inter for the interface and every figure (tabular numerals matter in a ledger), Martel for headings and
  the wordmark, Tiro Devanagari Sanskrit for verses. All three are self-hosted by `next/font`; nothing is fetched from
  Google at run time. The report PDF carries its own three subsetted Noto faces in `public/fonts/` — a PDF cannot
  borrow the page's fonts, and the built-in ones have no ₹ and no `ā`/`ṣ`. See `docs/pdf-fonts.md`.
- **Crest** — an eight-petalled lotus, drawn as vector paths in `components/Brand.tsx`. `public/lotus.svg` and
  `public/icon.svg` are the same mark; the PNG home-screen icons and `app/favicon.ico` are rendered from
  `public/icon.svg`. No external imagery is used, so the app looks right offline and as an installed PWA. To redraw
  the mark, edit the two path constants at the top of `components/Brand.tsx` and re-render the icons from the SVG.
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
