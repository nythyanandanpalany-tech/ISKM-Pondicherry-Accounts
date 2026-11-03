# ExpenseFlow

Workspace-based expense & income ledger for temples / seva groups, modelled on myexpenseflow.in,
plus two additions: **two images per entry** (bill + payment screenshot) and **bank-statement reconciliation**.

## Setup
1. Create a free project at https://supabase.com
2. SQL Editor → paste `supabase/schema.sql` → Run
3. `cp .env.local.example .env.local`, fill Project URL + anon key (Project Settings → API)
4. `npm install && npm run dev` → http://localhost:3000
5. Sign up, create a workspace (you become Owner), add members by their sign-up email in Settings.
6. Deploy on Vercel with the same two env vars. In Supabase → Auth → URL config add your domain.

## Features
Dashboard (stats, budget gauges, activity, daily Report PNG/share) · Ledger (search, period chips, sort, filters, Excel/PDF) ·
Analytics · Claims (submitted → approved → settled, member balances) · Add entry (expense/income, receipt rule, photo compression ≤150 KB,
own-pocket claim) · Workspaces + roles (owner/admin/editor/viewer, see-all & download toggles) · Categories/items/people/monthly limits ·
Excel import · Help/Privacy · **Bank Statement + Reconcile** (CSV import, scored suggestions, auto-match).

## Not built yet
Chats, Store (stock in/out), Vouchers for entries without a bill, donation-receipt PDFs, Advanced option view, theme toggle, in-app support inbox.
Note: "can download" is enforced in the UI only; row-level security protects the data itself.
