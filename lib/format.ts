export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
export const dmy = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
export const today = () => new Date().toISOString().slice(0, 10);

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
/** Parse common bank-statement dates into YYYY-MM-DD. */
export function parseDate(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ,]*(\d{2,4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}
export const num = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/[,₹\s]/g, ""));
  return isNaN(n) ? 0 : n;
};
export const daysBetween = (a: string, b: string) =>
  Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

/** 1.2k / 1.5L / 2.3Cr style (Indian) */
export const compact = (n: number) => {
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  const f = (v: number, u: string) => `${sign}${(Math.round(v * 10) / 10).toString()}${u}`;
  if (a >= 1e7) return f(a / 1e7, "Cr"); if (a >= 1e5) return f(a / 1e5, "L"); if (a >= 1e3) return f(a / 1e3, "k");
  return `${sign}${a}`;
};
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const below100 = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
const below1000 = (n: number) => (n >= 100 ? ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + below100(n % 100) : "") : below100(n));
/** 12345.5 -> "Twelve Thousand Three Hundred Forty Five Rupees and Fifty Paise Only" */
export function rupeesInWords(amount: number): string {
  const r = Math.floor(amount), p = Math.round((amount - r) * 100);
  const parts: string[] = []; let n = r;
  for (const [div, name] of [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]] as [number, string][]) {
    if (n >= div) { parts.push(below1000(Math.floor(n / div)) + " " + name); n %= div; }
  }
  if (n > 0) parts.push(below1000(n));
  const rs = parts.length ? parts.join(" ") : "Zero";
  return `${rs} Rupees${p ? " and " + below100(p) + " Paise" : ""} Only`;
}
