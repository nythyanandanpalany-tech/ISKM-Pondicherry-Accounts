/**
 * Calendar helpers for the reports: weeks, months, financial-year quarters and the financial year
 * itself (April–March). Everything works on YYYY-MM-DD strings and UTC arithmetic, never on local
 * time, so a report built at 11 pm IST is not stamped as tomorrow's.
 */
import { dmy } from "./format";

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First day of the financial year containing `date`: 2026-11-19 -> 2026-04-01, 2027-02-10 -> 2026-04-01. */
export function fyStart(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}
export const fyEnd = (date: string) => `${Number(fyStart(date).slice(0, 4)) + 1}-03-31`;
export const fyName = (date: string) => { const y = Number(fyStart(date).slice(0, 4)); return `${y}-${y + 1}`; };

export type Range = { from: string; to: string; label: string };
export type Period = "week" | "month" | "quarter" | "fy" | "custom";

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Monday to Sunday: the calendar week the weekly settlement uses. */
export function weekRange(date: string): Range {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();            // 0 = Sunday
  const from = addDays(date, -((dow + 6) % 7));
  const to = addDays(from, 6);
  return { from, to, label: `Week ${dmy(from)} – ${dmy(to)}` };
}

export function monthRange(date: string): Range {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, label: `${MONTHS[m - 1]} ${y}` };
}

/** Financial-year quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar. */
export function quarterRange(date: string): Range {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const q = m >= 4 ? Math.floor((m - 4) / 3) : 3;                    // 0..3
  const startMonth = [4, 7, 10, 1][q];
  const startYear = startMonth >= 4 ? (m >= 4 ? y : y - 1) : (m >= 4 ? y + 1 : y);
  const endMonth = startMonth + 2;
  const from = `${startYear}-${pad(startMonth)}-01`;
  const to = `${startYear}-${pad(endMonth)}-${pad(lastDay(startYear, endMonth))}`;
  const fy = fyName(date);
  return { from, to, label: `Q${q + 1} ${fy.slice(0, 4)}-${fy.slice(7)} (${MONTHS[startMonth - 1].slice(0, 3)}–${MONTHS[endMonth - 1].slice(0, 3)} ${startYear})` };
}

export function fyRange(date: string): Range {
  return { from: fyStart(date), to: fyEnd(date), label: `Financial year ${fyName(date)}` };
}

export function rangeFor(period: Period, anchor: string): Range {
  return period === "week" ? weekRange(anchor) : period === "month" ? monthRange(anchor) : period === "quarter" ? quarterRange(anchor) : fyRange(anchor);
}

/** The period before (-1) or after (+1) `r`, of the same kind. */
export function shift(period: Exclude<Period, "custom">, r: Range, dir: -1 | 1): Range {
  return rangeFor(period, dir < 0 ? addDays(r.from, -1) : addDays(r.to, 1));
}

/** "05/12/2026 – 11/12/2026", or just the one day. */
export const rangeText = (from: string, to: string) => (from === to ? dmy(from) : `${dmy(from)} – ${dmy(to)}`);
