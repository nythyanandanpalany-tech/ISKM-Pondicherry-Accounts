export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
export const dmy = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
export const today = () => new Date().toISOString().slice(0, 10);

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
/**
 * Assemble YYYY-MM-DD, but only if the calendar really has that day.
 * Entry dates are stored and sorted as plain strings, so an impossible one like "2026-02-31" or
 * "2026-13-01" would quietly corrupt every date filter and ordering that touches it. Returning
 * null instead means the importer reports the row as skipped and the operator can look at it.
 */
function iso(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

/** Parse common bank-statement dates into YYYY-MM-DD, or null if it is not a real date. */
export function parseDate(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = year(m[3]);
    // Day first, the way Indian statements write it — unless only the other reading has a valid
    // month, which is how a US-format export (01/13/2026) gets read correctly instead of as month 13.
    if (a > 12 && b <= 12) return iso(y, b, a);
    if (b > 12 && a <= 12) return iso(y, a, b);
    return iso(y, b, a);
  }
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ,]*(\d{2,4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return iso(year(m[3]), mi + 1, Number(m[1]));
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
