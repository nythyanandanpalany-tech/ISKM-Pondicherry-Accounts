# ExpenseFlow — Firebase edition (`firebase` branch)

Workspace-based expense & income ledger for temples / seva groups, with **two images per entry** (bill + payment screenshot)
and **bank-statement reconciliation**. Runs entirely on Firebase: Auth, Firestore, Cloud Storage, Hosting.
(The `main` branch is the same app on Supabase.)

Sample screens from a real run against the Firebase emulators are in `docs/sample/`.

## Try it locally (no Google account needed)
```bash
npm install
npm run emulators            # Auth + Firestore + Storage emulators (needs Java)
cp .env.local.example .env.local   # then uncomment NEXT_PUBLIC_USE_EMULATORS=1
npm run dev                  # http://localhost:3000
npm run test:rules           # 51 security-rule tests
```

## Go live
1. https://console.firebase.google.com → **Add project**.
2. **Upgrade to the Blaze plan** (pay-as-you-go; needs a card). Cloud Storage requires it. Then set a **budget alert** (Billing → Budgets) at, say, ₹200 — alerts warn but do **not** stop spending.
3. **Authentication → Sign-in method**: enable *Email/Password* and *Email link (passwordless)*. Add your domain under *Authorized domains*.
4. **Firestore Database → Create** (production mode; pick a region near you, e.g. `asia-south1`).
5. **Storage → Get started** (pick the bucket region; the "always free" 5 GB applies to US regions only — check current pricing for others).
6. **Project settings → Your apps → Web app** → copy the config into `.env.local` (see `.env.local.example`).
7. Deploy rules and site:
   ```bash
   npx firebase login
   npx firebase use --add          # choose your project
   npx firebase deploy --only firestore:rules,firestore:indexes,storage
   npm run deploy                  # builds the static site and deploys to Hosting
   ```
8. For the photo **ZIP backup** (Settings → Free up photo space) allow browser downloads once:
   `gsutil cors set firebase/cors.json gs://YOUR-BUCKET`
9. Custom domain (e.g. one bought on GoDaddy): Hosting → *Add custom domain* and add the DNS records it shows.
10. Sign up in the app → create a workspace (you become Owner) → add members by their sign-up email in Settings.

## Automatic deploy (no tools needed on your computer)
Push this branch to GitHub; `.github/workflows/deploy.yml` builds and deploys the site and the rules to Firebase. Set the variable/secrets listed at the top of that file once. The free address is `https://<project-id>.web.app` — a custom domain can be added later.

## What it costs
Free quotas apply on Blaze; you pay only beyond them. Approx. (verify on Google's pricing pages): Firestore 1 GiB stored + 50k reads/day free; Cloud Storage 5 GB stored free in US regions, then a few rupees per GB-month; Hosting 10 GB free.
Photos are compressed to ~100 KB, so ~200 KB per entry ≈ 25,000 entries in 5 GB.

## How it is built
- `lib/db.ts` — a small query layer over Firestore/Auth/Storage so screens read like `db.from("entries").select().eq("workspace_id", id)`. Flat collections; every document carries `workspace_id`.
- `firebase/firestore.rules` — all permissions: roles (owner/admin/editor/viewer), "see only own entries", claim approval, stock never negative, chat privacy.
- `firebase/storage.rules` — photo access only for workspace members; images/PDF only; < 3 MB.
- `firebase/tests/` — rule tests (`npm run test:rules`).

## Known limits (be aware)
- **Storage rules not fully verified here.** They look up membership in Firestore (`firestore.get`). The emulator in the build sandbox couldn't evaluate cross-service lookups, so that membership check is untested; the Firestore rules are fully tested. After deploying, check once: a signed-in user who is *not* in a workspace must not be able to open its photos. `firebase/tests/storage.test.mjs` does this on a normal machine. The local demo uses `firebase/storage.emulator.rules`, which skips the membership check.
- Photo links are Firebase download URLs (long, unguessable, but not time-limited).
- Editors could in principle change a store item's stock count without recording a move through the API (the app and rules keep it ≥ 0 and consistent when recorded properly). Owners/admins see every change in History.
- Lists read every matching document in the browser (sorting/filters run client-side). Fine for a temple; add pagination if reads become a cost.
- Any signed-in user can check whether an email is registered (needed for "add member by email").
- No spending cap on Blaze — keep the budget alert.
- Donation receipts/letterhead are intentionally not built yet.
