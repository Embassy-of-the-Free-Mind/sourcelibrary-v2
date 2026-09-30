/**
 * Google Cloud spend over a trailing window (last 90 days, year to date) for
 * /admin/spend (#5225).
 *
 * PRIOR ART: src/lib/spend-report.ts — holds the report's types and the access
 * gate but no arithmetic; the page summed months inline. Kept separate so this
 * stays pure (no Mongo/auth imports) and testable without mocks.
 *
 * Two sources cover a window: the daily BigQuery export (exact, from `gcpFrom`)
 * and the monthly invoice ledger for anything earlier. A ledger month only
 * partly inside the window is pro-rated by days — an approximation, so the
 * result reports how much of the total came from each source, and which
 * ledger months were estimates rather than settled invoices.
 */
import type { DailyRow, MonthlyRow } from '@/lib/spend-report';

export interface GcpWindow {
  from: string;
  to: string;
  total: number;
  /** Portion from the daily export (exact). */
  daily: number;
  /** Portion from ledger months, pro-rated where the month straddles the window edge. */
  ledger: number;
  /** Ledger months in the window whose figure is not a settled invoice. */
  estimatedMonths: string[];
}

const DAY_MS = 86_400_000;
const toMs = (day: string) => Date.parse(day + 'T00:00:00Z');
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `day` minus n days, as YYYY-MM-DD (UTC). */
export function daysBefore(day: string, n: number): string {
  return toDay(toMs(day) - n * DAY_MS);
}

export function gcpWindow(
  months: MonthlyRow[],
  daily: DailyRow[],
  gcpFrom: string,
  gcpTo: string,
  from: string,
): GcpWindow {
  const dailyPart = daily
    .filter(d => d.day >= from && d.day >= gcpFrom && d.day <= gcpTo)
    .reduce((a, d) => a + d.byDriver.reduce((x, y) => x + y, 0), 0);

  let ledger = 0;
  const estimatedMonths: string[] = [];
  const ledgerEnd = Math.min(toMs(gcpFrom) - DAY_MS, toMs(gcpTo)); // last day the ledger must cover
  for (const m of months) {
    const cell = m.vendors['Google Cloud'];
    if (!cell) continue;
    const mStart = toMs(m.month + '-01');
    const [y, mo] = m.month.split('-').map(Number);
    const mEnd = Date.UTC(y, mo, 0); // last day of the month
    const lo = Math.max(mStart, toMs(from));
    const hi = Math.min(mEnd, ledgerEnd);
    if (hi < lo) continue;
    const share = (Math.round((hi - lo) / DAY_MS) + 1) / (Math.round((mEnd - mStart) / DAY_MS) + 1);
    ledger += cell.v * share;
    if (cell.grade !== 'settled') estimatedMonths.push(m.month);
  }

  return { from, to: gcpTo, total: dailyPart + ledger, daily: dailyPart, ledger, estimatedMonths };
}
