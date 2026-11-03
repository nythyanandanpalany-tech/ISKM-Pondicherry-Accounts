import * as XLSX from "xlsx";
import type { Entry } from "./types";

export function toExcel(rows: Entry[], names: { cat: (id: string | null) => string; item: (id: string | null) => string; person: (id: string | null) => string }, file = "ledger.xlsx") {
  const data = rows.map((e) => ({
    "Bill Date": e.entry_date, Type: e.type, Category: names.cat(e.category_id), Item: names.item(e.item_id), Member: names.person(e.person_id),
    Mode: e.payment_mode, Status: e.claim_status ?? "direct", Receipt: e.bill_path ? "Yes" : e.receipt_available ? "Missing" : "No",
    "Payment screenshot": e.payment_proof_path ? "Yes" : "No", Reference: e.reference_no ?? "", "Fund source": e.fund_source ?? "", Beneficiary: e.beneficiary ?? "", Note: e.note ?? "", Amount: e.amount,
  }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Ledger"); XLSX.writeFile(wb, file);
}

export function toCsv(rows: Entry[], names: { cat: (id: string | null) => string; item: (id: string | null) => string; person: (id: string | null) => string }, file = "ledger.csv") {
  const ws = XLSX.utils.json_to_sheet(rows.map((e) => ({ Date: e.entry_date, Type: e.type, Category: names.cat(e.category_id), Item: names.item(e.item_id), Member: names.person(e.person_id), Mode: e.payment_mode, Status: e.claim_status ?? "direct", Note: e.note ?? "", Amount: e.amount })));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([XLSX.utils.sheet_to_csv(ws)], { type: "text/csv" })); a.download = file; a.click();
}

export async function readExcel(file: File): Promise<Record<string, string>[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  return XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: "" });
}
