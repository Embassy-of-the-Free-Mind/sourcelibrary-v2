import { describe, it, expect } from 'vitest';
import { daysBefore, gcpWindow } from '@/lib/spend-windows';
import type { DailyRow, MonthlyRow } from '@/lib/spend-report';

// Synthetic figures only — the real ledger is private (#5225).
const months: MonthlyRow[] = [
  { month: '2026-01', vendors: { 'Google Cloud': { v: 310, grade: 'settled' } } },
  { month: '2026-02', vendors: { 'Google Cloud': { v: 280, grade: 'est' } } },
  { month: '2026-03', vendors: { 'Google Cloud': { v: 3100, grade: 'settled' } } },
  // March 4th onward is covered by the daily export; the ledger must not double-count it.
];
const daily: DailyRow[] = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']
  .map(day => ({ day, byDriver: [10, 5], byProject: [15] }));

describe('gcpWindow', () => {
  it('year to date sums whole ledger months and flags estimated ones', () => {
    const w = gcpWindow(months.slice(0, 2), [], '2026-03-01', '2026-02-28', '2026-01-01');
    expect(w.total).toBeCloseTo(590);
    expect(w.estimatedMonths).toEqual(['2026-02']);
  });

  it('pro-rates a ledger month that straddles the window start', () => {
    // Jan 22–31 = 10 of 31 days of January.
    const w = gcpWindow(months.slice(0, 1), [], '2026-02-01', '2026-01-31', '2026-01-22');
    expect(w.ledger).toBeCloseTo(100);
  });

  it('switches from ledger to daily export at gcpFrom without double counting', () => {
    // Ledger covers Mar 1–3 (3/31 of 3100 = 300); export covers Mar 4–5 (2 × 15).
    const w = gcpWindow(months, daily, '2026-03-04', '2026-03-05', '2026-03-01');
    expect(w.ledger).toBeCloseTo(300);
    expect(w.daily).toBeCloseTo(30);
    expect(w.total).toBeCloseTo(330);
  });

  it('daysBefore crosses month and year edges', () => {
    expect(daysBefore('2026-09-29', 89)).toBe('2026-07-02');
    expect(daysBefore('2026-01-01', 1)).toBe('2025-12-31');
  });
});
