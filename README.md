# ExpenseFlow

Expense tracking for temple / seva groups, with an accountant workflow.
Each expense carries **two images**: the **payment screenshot** and the **bill**.
Imported bank-statement rows are then matched to expenses on a side-by-side Reconcile screen.

## Setup
1. Create a free project at https://supabase.com
2. SQL Editor → paste `supabase/schema.sql` → Run (tables, security rules, private `receipts` bucket, default categories)
3. `cp .env.local.example .env.local` and fill in Project URL + anon key (Project Settings → API)
4. `npm install && npm run dev` → http://localhost:3000
5. Sign up. The **first account becomes admin**; promote others under Settings → Users.
6. Deploy: push to GitHub, import in Vercel, add the same two env vars.

## Roles
- member: adds own expenses, edits them while pending
- accountant: sees all, approves/rejects, imports bank statements, reconciles
- admin: everything + role management

## Matching logic (lib/match.ts)
Score = amount equal (+50) · UTR found in statement (+60) · same day (+20) / ≤3 days (+10) · vendor name in narration (+10).
"Auto-match" only links a transaction when exactly one expense scores ≥ 70.
