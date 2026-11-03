# ExpenseFlow

Workspace-based expense & income ledger for temples / seva groups, modelled on myexpenseflow.in,
plus two additions: **two images per entry** (bill + payment screenshot) and **bank-statement reconciliation**.

## Setup
1. Create a free project at https://supabase.com
2. SQL Editor → run `supabase/schema.sql`, then `002_store_chats.sql`, then `003_storage_usage.sql` (in that order)
3. `cp .env.local.example .env.local`, fill Project URL + anon key (Project Settings → API)
4. `npm install && npm run dev` → http://localhost:3000
5. Sign up, create a workspace (you become Owner), add members by their sign-up email in Settings.
6. Deploy on Vercel with the same two env vars. In Supabase → Auth → URL config add your domain.

## Features
**Accounts:** Dashboard (stats, budget gauges, activity) · Ledger (search, period chips, sort, filters, Excel/PDF, **Vouchers** for expenses without a bill) ·
Analytics · Claims (submitted → approved → settled) · daily Report (PNG/share) · Add entry (expense/income, photo compression ≤150 KB) ·
**two images per entry** (bill + payment screenshot) · **Bank Statement + Reconcile** (CSV import, scored suggestions, auto-match).
**Team:** workspaces, roles (owner/admin/editor/viewer), see-all & download toggles, **Chats** (workspace room, private by @username, groups, unread badge, realtime, optional browser alerts),
**Store** (stores, items with units, stock in/out, low-stock, history, no negative stock).
**Settings:** categories/items/people/monthly limits, Excel import, modules on/off, theme (system/light/dark), Standard vs Advanced view
(Advanced adds fund source, beneficiary, CSV, All Bills, modules), sample workspace, guided tour, in-app Support/Suggestions (rows land in the `feedback` table),
install-as-app (PWA manifest), delete account.

## Deliberately not built
Donation receipts / letterhead (to be specified). Profile photo upload. "Can download" is enforced in the UI only; row-level security protects the data itself.

## Using the Supabase CLI instead of the SQL editor
`supabase/migrations/` holds the same two SQL files in order. After `supabase link --project-ref <ref>`, run `supabase db push`.

## Running at zero cost
Everything here fits free plans, no card needed:
- **Supabase free** — database + login + photo storage + realtime chat. Limits: 500 MB database, **1 GB photos**, 5 GB bandwidth/month; a project pauses after ~7 days of no use.
- **Vercel Hobby (or Cloudflare Pages / Netlify free)** — hosts the website at a free `*.vercel.app` address. A custom domain is the only optional cost.
  (Vercel's Hobby plan is meant for non-commercial use; a temple/seva group is, but check their current terms.)
- **No pausing:** `vercel.json` runs a daily ping (`/api/keepalive`) so Supabase never sees a quiet week. If you host elsewhere, schedule any free uptime pinger to hit `/api/keepalive` once a day.
- **Photos stay small:** every photo is compressed in the browser to ~100 KB (WebP/JPEG, long edge ≤ 1600 px); PDFs over 2 MB are refused. ~200 KB per entry with both images ≈ **5,000 entries per free GB**.
- **Watch the meter:** Settings shows photo storage used; the Dashboard warns admins at 75%.
- **When it fills up:** Settings → *Free up photo space* → download a ZIP of photos older than N months, then remove them from the server. Entries and amounts are kept.
- **Backups (free plan has none):** export the Ledger to Excel monthly and keep the photo ZIPs.
