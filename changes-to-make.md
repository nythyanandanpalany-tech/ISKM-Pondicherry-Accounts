# ISKM Pondicherry Seva Accounts – Changes to Make
Website: iskm-pondicherry-accounts.vercel.app (code on GitHub)

## Change 1 – Add logo
- Add the new logo (header, login page, reports/vouchers)
- To confirm: is it the ISKM Pondicherry lotus logo used on the vouchers (iskm-pondicherry-logo-from-vouchers.png), or a different new logo?

## Change 2 – Colours
- Change the website colours to match the logo

## Change 2A – Add Prabhupada photo
- Add a photo of Srila Prabhupada to the website
- Use the SAME photo already used on the bank/cash vouchers and receipts (extracted as prabhupada-photo.png, 458x500)
- Placement still to be decided (e.g. login page, dashboard, reports)

## Change 3 – Accounting module (starts from 1 November 2026)

### A. Entries (vouchers)
Same numbering style as existing vouchers, e.g. 2025-2026/BV/05/V018:
- CV = Cash Voucher (cash expense)
- BV = Bank Voucher (bank expense)
- CR = Cash Receipt (cash donation / income)
- BR = Bank Receipt (bank donation / income)
- JV = Journal Voucher (NEW): adjustments with no cash or bank movement
  (bills not yet paid, moving an amount between heads, correcting a mistake)
- Cash self-voucher allowed where no bill exists, but flagged as "no bill"
- The 3 entries already made in November (Rs 1,737) become vouchers automatically
  (UPI / bank transfer -> Bank, cash -> Cash)

### B. Books and reports
- Journal -> Ledger -> Trial Balance (accrual basis, FY April–March)
- Three separate books: Temple, Goshala, Books
  - Gaushala expenses -> Goshala book
  - Purchase of books -> Books book
  - Everything else -> Temple book
- Construction = separate section inside the Temple book (auditor to confirm)
- Reports for any date range, mainly weekly and monthly
- Auditor pack (Excel + PDF), monthly and quarterly:
  Trial balance, Ledgers, Journal register, Cash book, Bank book,
  Bank reconciliation, Income & Expenditure, Balance sheet, Receipts & Payments
- Extra sheets: Day book, Fund-wise statement, Bills-missing list,
  Unpaid bills list, Donations without donor name
- No month-locking
- No depreciation, no asset register for now

### C. Weekly settlement (calendar week)
A week is "settled" when: bank matched, cash counted, trial balance tallies, bills attached

### D. Who can do what
- Super admin (Prabhu): everything, can edit and delete
- Main accountant: sees everything, can create journals
- Entry user: adds entries, sees only own entries, cannot edit or delete
- Full-view access: super admin can switch it on for any user

### E. Daily report
Purpose: announce income and expense every day at Mangalarti (Srila Prabhupada's standard)
- Daily ledger / day book: income received and expense made each day
- Sent at 3:30 AM every morning (India time), one hour before Mangalarti
- Covers the PREVIOUS full day (midnight to midnight)
  Example: report for 15 Nov is sent on 16 Nov at 3:30 AM
- Message order:
  1. Total income and total expense
  2. Breakdown by head (e.g. Annadanam, Gaushala), income and expense
  3. Donor names with amounts
- One combined report for all books, plus Temple, Goshala and Books separately
- English for now; Tamil to be added later when Prabhu says
- If a day has no entries: send nothing
- Channel: Telegram group first (to test); WhatsApp later once it works well
- Telegram bot: new separate bot "ISKM Pondicherry Reporting" (not the trading bot)
  Create via @BotFather, add to the group, keep the token secret (app secret settings only)
  To be created LAST

### F. Waiting for information (build without these now)
- Funds (FCRA, CSR, Building etc.): added later after seva tier list is approved by HG Prahlad Prabhu
- April–October opening balances: Prabhu will provide
- BBT trade book: Prabhu will confirm
- Construction placement: auditor's answer
- 80G receipts: handled in another website

### G. Build order
1. Logo and colours
2. Users and roles
3. Vouchers (CV, BV, CR, BR, JV) and the 3 existing November entries
4. Ledgers and trial balance
5. Weekly settlement checks
6. Daily report (message text and daily ledger)
7. Auditor pack (Excel + PDF)
8. LAST: create the Telegram bot and connect it to the group

### H. DRAFT chart of accounts (from FY2025-26 final accounts – for Prabhu's approval)
INCOME
- Donations – received in bank
- Donations – received in cash
- Sale of books
- Interest on savings bank accounts
EXPENSES (running)
- Allowance (staff / devotees)
- Annadanam
- Purchase of books
- Gaushala
- Festival
- Fees, electricity & other charges
- Travelling
- Deity & Puja
- Medical
- Office
- Miscellaneous
- Bank charges
CAPITAL (not charged to expenses)
- Construction – Building
- Fixed assets purchased
ASSETS
- Cash in hand
- Bank – Ujjivan Small Finance Bank
- Bank – IDFC FIRST
- Loans & advances
- Recoverable from BBT trade book (until BBT decision)
LIABILITIES / CAPITAL
- Capital Fund
- Outstanding expenses (bills not yet paid – needed for accrual)
- Loans received
