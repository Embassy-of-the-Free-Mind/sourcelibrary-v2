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
  budgetAllowsDispatchScoped,
  readScopeEnvelopes,
  _setSupabaseSpendReaderForTests,
  _setSupabaseScopeSpendReaderForTests,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/spend-guard.mjs';

// Default: Supabase store empty and readable. Individual tests override.
beforeEach(() => {
  _setSupabaseSpendReaderForTests(async () => ({ usd: 0, rows: 0, costlessRows: 0, error: null }));
  _setSupabaseScopeSpendReaderForTests(async () => ({ usd: 0, rows: 0, error: null }));
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

// ─── Scope envelopes (#4540) ────────────────────────────────────────────────

describe('readScopeEnvelopes — only positive finite budgets are envelopes', () => {
  it('filters non-budgeted, zero, negative and malformed budgets', () => {
    const control = {
      allow_scopes: {
        good: { book_ids: ['a'], budget_usd: 5 },
        pauseOnly: { book_ids: ['b'] },
        zero: { book_ids: ['c'], budget_usd: 0 },
        negative: { book_ids: ['d'], budget_usd: -3 },
        stringy: { book_ids: ['e'], budget_usd: '5' },
      },
    };
    const envs = readScopeEnvelopes(control);
    expect(envs.map((e: { tag: string }) => e.tag)).toEqual(['good']);
    expect(envs[0].budget_usd).toBe(5);
  });
  it('empty/missing allow_scopes → no envelopes', () => {
    expect(readScopeEnvelopes({})).toEqual([]);
    expect(readScopeEnvelopes(undefined)).toEqual([]);
  });
});

/**
 * Stub distinguishing the DAILY aggregate (matches by _id time range only)
 * from a SCOPE aggregate (matches book_id) on the same gemini_usage collection.
 */
function makeScopedDbStub({ dailyUsd = 0, scopeUsd = 0, control }: {
  dailyUsd?: number; scopeUsd?: number; control: Record<string, unknown>;
}) {
  return {
    collection(name: string) {
      return {
        aggregate: (pipeline: Array<{ $match?: Record<string, unknown> }>) => {
          const isScope = !!pipeline[0]?.$match?.book_id;
          const usd = isScope ? scopeUsd : dailyUsd;
          return { toArray: async () => (usd === 0 ? [] : [{ _id: null, usd, rows: 1, costlessRows: 0 }]) };
        },
        findOne: async () => (name === 'system_config' ? control : null),
        find: () => ({ project: () => ({ toArray: async () => [] }) }),
      };
    },
  };
}

describe('budgetAllowsDispatchScoped — a second ceiling, never an absence of one', () => {
  const envControl = (over: Record<string, unknown> = {}) => ({
    _id: 'processing_control',
    daily_budget_usd: 5,
    allow_scopes: { lane: { book_ids: ['b1', 'b2'], budget_usd: 10, created_at: new Date('2026-09-01T00:00:00Z') } },
    ...over,
  });

  it('global dial open → unrestricted dispatch, envelopes not consulted', async () => {
    const db = makeScopedDbStub({ dailyUsd: 2, control: envControl() });
    const g = await budgetAllowsDispatchScoped(db, 'test');
    expect(g.allowed).toBe(true);
    expect(g.envelopeIds).toBeNull();
  });

  it('dial closed + envelope with room → scoped dispatch confined to the envelope books', async () => {
    const db = makeScopedDbStub({ dailyUsd: 21, scopeUsd: 3, control: envControl() });
    const g = await budgetAllowsDispatchScoped(db, 'test');
    expect(g.allowed).toBe(true);
    expect([...g.envelopeIds!].sort()).toEqual(['b1', 'b2']);
  });

  it('dial closed + envelope spent → refused (ceilings all the way down)', async () => {
    const db = makeScopedDbStub({ dailyUsd: 21, scopeUsd: 10, control: envControl() });
    const g = await budgetAllowsDispatchScoped(db, 'test');
    expect(g.allowed).toBe(false);
  });

  it('dial closed + no envelopes → refused (a pause-only scope never opens the dial)', async () => {
    const db = makeScopedDbStub({ dailyUsd: 21, control: envControl({ allow_scopes: { lane: { book_ids: ['b1'] } } }) });
    const g = await budgetAllowsDispatchScoped(db, 'test');
    expect(g.allowed).toBe(false);
  });

  it('dial UNSET (default-closed) + envelope with room → scoped dispatch (an envelope is an explicit bounded grant)', async () => {
    const db = makeScopedDbStub({ scopeUsd: 3, control: envControl({ daily_budget_usd: null }) });
    const g = await budgetAllowsDispatchScoped(db, 'test');
    expect(g.allowed).toBe(true);
    expect(g.envelopeIds!.size).toBe(2);
  });

  it('FAILS CLOSED for every lane when the daily meter is unreadable', async () => {
    supaStub(0, 0, 'Supabase read error: fetch failed');
    const db = makeScopedDbStub({ dailyUsd: 0, scopeUsd: 0, control: envControl() });
    const g = await budgetAllowsDispatchScoped(db, 'test');
    expect(g.allowed).toBe(false);
  });

  it('FAILS CLOSED for an envelope whose own meter is unreadable', async () => {
    _setSupabaseScopeSpendReaderForTests(async () => ({ usd: 0, rows: 0, error: 'Supabase read failed (500)' }));
    const db = makeScopedDbStub({ dailyUsd: 21, scopeUsd: 0, control: envControl() });
    const g = await budgetAllowsDispatchScoped(db, 'test');
    expect(g.allowed).toBe(false);
  });

  it('envelope spend SUMS both stores — Supabase spend alone can close the envelope', async () => {
    _setSupabaseScopeSpendReaderForTests(async () => ({ usd: 9.5, rows: 100, error: null }));
    const db = makeScopedDbStub({ dailyUsd: 21, scopeUsd: 0.6, control: envControl() });
    const g = await budgetAllowsDispatchScoped(db, 'test');
    expect(g.allowed).toBe(false); // 9.5 + 0.6 >= 10
  });

  it('bypass short-circuits, unrestricted', async () => {
    const db = makeScopedDbStub({ dailyUsd: 999, control: envControl() });
    const g = await budgetAllowsDispatchScoped(db, 'test', { bypass: true });
    expect(g.allowed).toBe(true);
    expect(g.envelopeIds).toBeNull();
  });
});
