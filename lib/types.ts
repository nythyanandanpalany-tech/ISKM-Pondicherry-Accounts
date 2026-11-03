export type Role = "admin" | "accountant" | "member";
export type Profile = { id: string; email: string; full_name: string | null; role: Role };
export type Category = { id: string; name: string };
export type Account = { id: string; name: string; type: string };
export type Expense = {
  id: string; created_by: string; expense_date: string; title: string; vendor: string | null;
  amount: number; category_id: string | null; account_id: string | null; payment_mode: string | null;
  utr: string | null; notes: string | null; payment_proof_path: string | null; bill_path: string | null;
  status: "pending" | "approved" | "rejected"; created_at: string;
};
export type Txn = {
  id: string; txn_date: string; description: string | null; reference: string | null; amount: number;
  direction: "debit" | "credit"; account_id: string | null; matched_expense_id: string | null;
};
