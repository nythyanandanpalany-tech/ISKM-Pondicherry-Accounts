# ExpenseFlow

Workspace-based expense & income ledger for temples / seva groups, modelled on myexpenseflow.in,
plus two additions: **two images per entry** (bill + payment screenshot) and **bank-statement reconciliation**.

## Setup
1. Create a free project at https://supabase.com
2. SQL Editor → run `supabase/schema.sql`, then `supabase/002_store_chats.sql` (in that order)
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
