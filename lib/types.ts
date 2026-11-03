export type Role = "owner" | "admin" | "editor" | "viewer";
export type Profile = { id: string; email: string; full_name: string | null; username: string | null; advanced: boolean };
export type Workspace = { id: string; name: string; currency: string; date_format: string; org_type: string; monthly_budget: number | null; primary_purchaser: string | null; letterhead: string | null; modules: { store: boolean; chats: boolean }; is_demo: boolean };
export type Member = { workspace_id: string; user_id: string; role: Role; see_all: boolean; can_download: boolean; profiles?: { full_name: string | null; email: string } | null };
export type Category = { id: string; workspace_id: string; name: string; kind: "expense" | "income"; monthly_limit: number | null };
export type Item = { id: string; workspace_id: string; category_id: string; name: string; monthly_limit: number | null };
export type Person = { id: string; workspace_id: string; name: string };
export type Entry = {
  id: string; workspace_id: string; type: "expense" | "income"; entry_date: string; amount: number;
  category_id: string | null; item_id: string | null; person_id: string | null; payment_mode: string;
  note: string | null; reference_no: string | null; receipt_available: boolean;
  bill_path: string | null; payment_proof_path: string | null;
  fund_source: string | null; beneficiary: string | null;
  claim_status: "submitted" | "approved" | "settled" | null; claim_settled_at: string | null;
  created_by: string; created_at: string; updated_at: string;
};
export type Txn = {
  id: string; workspace_id: string; txn_date: string; description: string | null; reference: string | null;
  amount: number; direction: "debit" | "credit"; matched_entry_id: string | null;
};
export const MODES = ["Cash", "UPI", "Bank Transfer", "Cheque", "Card", "Other"];

export type Store = { id: string; workspace_id: string; name: string };
export type StoreItem = { id: string; workspace_id: string; store_id: string; name: string; unit: string; min_qty: number };
export type StockMove = { id: string; store_item_id: string; direction: "in" | "out"; qty: number; move_date: string; note: string | null; created_by: string | null; created_at: string };
export type ChatThread = { id: string; workspace_id: string | null; kind: "workspace" | "private" | "group"; title: string | null };
export type ChatMsg = { id: string; thread_id: string; sender_id: string | null; body: string; created_at: string };
