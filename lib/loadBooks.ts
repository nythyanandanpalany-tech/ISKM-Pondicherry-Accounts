/**
 * Everything the reports read, fetched the same way the other screens do: straight from Supabase,
 * with row level security deciding what this person may see (only owners and admins see it all).
 * A request returns at most 1,000 rows, so the entries are fetched a page at a time.
 */
import { db, DUMMY_MODE } from "./db";
import type { Entry, OpeningBalance, Txn } from "./types";

const PAGE = 1000;

async function all<T>(table: string, workspace: string, order: string): Promise<T[]> {
  // Sample-data mode answers a fixed set of filters and cannot page; it is never large anyway.
  if (DUMMY_MODE) {
    const { data } = await db.from(table).select("*").eq("workspace_id", workspace).order(order).limit(5000);
    return (data as T[]) ?? [];
  }
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select("*").eq("workspace_id", workspace).order(order).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data as T[]) ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export type BooksData = { entries: Entry[]; opening: OpeningBalance[]; txns: Txn[] };

export async function loadBooksData(workspace: string): Promise<BooksData> {
  const [entries, opening, txns] = await Promise.all([
    all<Entry>("entries", workspace, "id"),
    all<OpeningBalance>("opening_balances", workspace, "account"),
    all<Txn>("bank_transactions", workspace, "id"),
  ]);
  return { entries, opening, txns };
}
