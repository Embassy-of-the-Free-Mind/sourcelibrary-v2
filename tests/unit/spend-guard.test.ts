/**
 * The budget dial (issue #3737): default-closed, UTC-day windowed, and
 * measured via ObjectId time range (the `timestamp` field is a string on old
 * rows — Date-range matching silently returns nothing).
 */
import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  utcDayStart,
  getTodaySpendUsd,
  readDailyBudgetUsd,
  budgetAllowsDispatch,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/spend-guard.mjs';

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
    expect(await getTodaySpendUsd(db)).toEqual({ usd: 0, rows: 0, costlessRows: 0 });
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
  it('bypass (explicit --book operator run) skips both reads', async () => {
    const { db, calls } = makeDbStub({ budget: null });
    expect(await budgetAllowsDispatch(db, 'test', { bypass: true })).toBe(true);
    expect(calls.findOnes).toBe(0);
    expect(calls.aggregates.length).toBe(0);
  });
});
