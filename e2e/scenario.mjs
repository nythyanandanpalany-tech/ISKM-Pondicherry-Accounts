// A month of ordinary temple life, loaded straight into the database (as the owner, so the real
// triggers number every voucher), with the figures the reports must show worked out by hand.
//
//   Temple   CV   100 Annadanam, cash            BV   200 Annadanam, UPI, Ujjivan
//            CR   500 Donation, cash (no donor)  BR   400 Donation, transfer, Ujjivan (Ramesh)
//            CR   250 Hundi, cash                BV  4000 Construction – Building, Ujjivan (capital)
//            JV  1000 Annadanam, bill not yet paid   BV 400 Annadanam, Ujjivan — pays 400 of that bill
//   Goshala  CV   300 Gaushala, cash
//   Books    BV    50 Purchase of books, UPI, IDFC
//   Opening  Temple: cash 5,000 · Ujjivan 20,000 · capital fund 25,000
//
//   All books  income 1,150 · expenditure 1,650 (the payment is not an expense again) · deficit 500
//              cash 5,000 -> 5,350 · Ujjivan 20,000 -> 15,800 · IDFC 0 -> -50
//              balance sheet 25,100 each side · 600 of the bill still unpaid
import { psql, DB } from "./stack.mjs";
import { BANK, CAT, PERSON, USERS, WS } from "./fixtures.mjs";

export const JV_ID = "e1000000-0000-4000-8000-000000000001";
export const RANGE = { from: "2026-11-01", to: "2026-11-30" };

export function loadScenario() {
  const row = (date, type, amount, mode, cat, extra = {}) => {
    const cols = { workspace_id: WS, type, entry_date: date, amount, payment_mode: mode, category_id: cat, created_by: USERS.owner.id, ...extra };
    const keys = Object.keys(cols);
    return `insert into entries (${keys.join(", ")}) values (${keys.map((k) => (cols[k] == null ? "null" : `'${String(cols[k]).replaceAll("'", "''")}'`)).join(", ")});`;
  };
  const sql = `
select set_config('request.jwt.claims', '{"sub":"${USERS.owner.id}"}', false);
${row("2026-11-03", "expense", 100, "Cash", CAT.annadanam, { note: "rice" })}
${row("2026-11-04", "expense", 200, "UPI", CAT.annadanam, { bank_account_id: BANK.ujjivan, note: "vegetables" })}
${row("2026-11-05", "income", 500, "Cash", CAT.donation, { note: "anonymous donation" })}
${row("2026-11-06", "income", 400, "Bank Transfer", CAT.donation, { bank_account_id: BANK.ujjivan, person_id: PERSON.ramesh, note: "named donation" })}
${row("2026-11-07", "expense", 300, "Cash", CAT.gaushala, { note: "cattle feed" })}
${row("2026-11-08", "expense", 50, "UPI", CAT.books, { bank_account_id: BANK.idfc, note: "books" })}
${row("2026-11-09", "journal", 1000, "Journal", null, { id: JV_ID, jv_kind: "unpaid_bill", dr_category_id: CAT.annadanam, note: "October electricity bill" })}
${row("2026-11-10", "expense", 4000, "UPI", CAT.construction, { bank_account_id: BANK.ujjivan, note: "foundation" })}
${row("2026-11-11", "income", 250, "Cash", CAT.hundi, { note: "weekly hundi" })}
${row("2026-11-20", "expense", 400, "UPI", CAT.annadanam, { bank_account_id: BANK.ujjivan, settles_entry_id: JV_ID, note: "part payment of the bill" })}
insert into opening_balances (workspace_id, book, account, amount) values
  ('${WS}', 'temple', 'cash', 5000),
  ('${WS}', 'temple', 'bank:${BANK.ujjivan}', 20000),
  ('${WS}', 'temple', 'capital_fund', -25000);
`;
  psql(["-d", DB], sql);
}
