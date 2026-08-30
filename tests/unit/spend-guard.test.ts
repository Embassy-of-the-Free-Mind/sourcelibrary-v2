/**
 * The budget dial (issue #3737): default-closed, UTC-day windowed, and
 * measured via ObjectId time range (the `timestamp` field is a string on old
 * rows — Date-range matching silently returns nothing).
 *
 * Since #3826 the guard sums BOTH gemini_usage stores (Supabase primary +
 * Mongo fallback) and FAILS CLOSED when the Supabase read errors — reading
 * one store is how a $15 dial billed $2.3K. Tests inject the Supabase half
 * via _setSupabaseSpendReaderForTests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  utcDayStart,
  getTodaySpendUsd,
  readDailyBudgetUsd,
  budgetAllowsDispatch,
  _setSupabaseSpendReaderForTests,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/spend-guard.mjs';

// Default: Supabase store empty and readable. Individual tests override.
beforeEach(() => {
  _setSupabaseSpendReaderForTests(async () => ({ usd: 0, rows: 0, costlessRows: 0, error: null }));
});
const supaStub = (usd: number, rows = 0, error: string | null = null) =>
  _setSupabaseSpendReaderForTests(async () => ({ usd, rows, costlessRows: 0, error }));

function makeDbStub({ spendUsd = 0, rows = 0, costlessRows = 0, budget }: {
  spendUsd?: number; rows?: number; costlessRows?: number; budget?: unknown;
}) {
  const calls: { aggregates: unknown[][]; findOnes: number } = { aggregates: [], findOnes: 0 };
  const db = {
    collection(name: string) {
      return {
        aggregate: (pipeline: unknown[]) => {
          calls.aggregates.push(pipeline);
          return { toArray: async () => (rows === 0 && spendUsd === 0 && costlessRows === 0
            ? []
            : [{ _id: null, usd: spendUsd, rows, costlessRows }]) };
        },
        findOne: async () => { calls.findOnes++; return name === 'system_config' ? { _id: 'processing_control', daily_budget_usd: budget } : null; },
      };
    },
  };
  return { db, calls };
}

describe('utcDayStart', () => {
  it('returns midnight UTC of the given instant', () => {
    const d = utcDayStart(new Date('2026-08-08T17:45:12.345Z'));
    expect(d.toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });
});

describe('readDailyBudgetUsd — the dial is default-closed', () => {
  it.each([
    ['unset', undefined], ['null', null], ['zero', 0], ['negative', -5],
    ['string number', '5'], ['NaN', NaN], ['Infinity', Infinity],
  ])('%s → null (no paid dispatch)', (_n, v) => {
    expect(readDailyBudgetUsd({ daily_budget_usd: v })).toBeNull();
    expect(readDailyBudgetUsd(undefined)).toBeNull();
  });
  it('a positive finite number is the ceiling', () => {
    expect(readDailyBudgetUsd({ daily_budget_usd: 5 })).toBe(5);
    expect(readDailyBudgetUsd({ daily_budget_usd: 0.5 })).toBe(0.5);
  });
});

describe('getTodaySpendUsd', () => {
  it('selects rows by ObjectId range from UTC midnight (never the timestamp field)', async () => {
    const { db, calls } = makeDbStub({ spendUsd: 1.23, rows: 10 });
    await getTodaySpendUsd(db, new Date('2026-08-08T17:00:00Z'));
    const match = (calls.aggregates[0][0] as { $match: { _id: { $gte: ObjectId } } }).$match;
    expect(match._id.$gte).toBeInstanceOf(ObjectId);
    expect(match._id.$gte.getTimestamp().toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });
  it('empty day → zeros', async () => {
    const { db } = makeDbStub({});
    expect(await getTodaySpendUsd(db)).toEqual({ usd: 0, rows: 0, costlessRows: 0, meterError: null });
  });
  it('SUMS both stores — the stores are mutually exclusive per row (#3826)', async () => {
    const { db } = makeDbStub({ spendUsd: 9, rows: 10 });
    supaStub(830, 6000);
    const spend = await getTodaySpendUsd(db);
    expect(spend.usd).toBe(839);
    expect(spend.rows).toBe(6010);
  });
  it('surfaces a Supabase read failure as meterError, never as zero', async () => {
    const { db } = makeDbStub({ spendUsd: 9, rows: 10 });
    supaStub(0, 0, 'Supabase read failed (500)');
    const spend = await getTodaySpendUsd(db);
    expect(spend.meterError).toBe('Supabase read failed (500)');
  });
});

describe('budgetAllowsDispatch', () => {
  it('refuses when no budget is set — and never queries spend (negative control)', async () => {
    const { db, calls } = makeDbStub({ budget: null });
    expect(await budgetAllowsDispatch(db, 'test')).toBe(false);
    expect(calls.aggregates.length).toBe(0);
  });
  it('dispatches under the ceiling', async () => {
    const { db } = makeDbStub({ spendUsd: 2.5, rows: 40, budget: 5 });
    expect(await budgetAllowsDispatch(db, 'test')).toBe(true);
  });
  it('refuses at the ceiling', async () => {
    const { db } = makeDbStub({ spendUsd: 5, rows: 80, budget: 5 });
    expect(await budgetAllowsDispatch(db, 'test')).toBe(false);
  });
  it('refuses above the ceiling', async () => {
    const { db } = makeDbStub({ spendUsd: 9.99, rows: 200, budget: 5 });
    expect(await budgetAllowsDispatch(db, 'test')).toBe(false);
  });
  it('spend in the PRIMARY store alone closes the dial (the #3826 blindness)', async () => {
    // Mongo (fallback) shows $9 — exactly what the incident-day guard saw —
    // while Supabase holds the real spend. The summed guard must refuse.
    const { db } = makeDbStub({ spendUsd: 9, rows: 10, budget: 15 });
    supaStub(830, 6000);
    expect(await budgetAllowsDispatch(db, 'test')).toBe(false);
  });
  it('FAILS CLOSED when the primary store is unreadable', async () => {
    const { db } = makeDbStub({ spendUsd: 0, rows: 0, budget: 15 });
    supaStub(0, 0, 'Supabase read error: fetch failed');
    expect(await budgetAllowsDispatch(db, 'test')).toBe(false);
  });
  it('bypass (explicit --book operator run) skips both reads', async () => {
    const { db, calls } = makeDbStub({ budget: null });
    expect(await budgetAllowsDispatch(db, 'test', { bypass: true })).toBe(true);
    expect(calls.findOnes).toBe(0);
    expect(calls.aggregates.length).toBe(0);
  });
});
