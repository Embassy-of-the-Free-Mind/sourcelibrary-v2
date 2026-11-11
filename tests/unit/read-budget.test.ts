import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /read hands over a book in a handful of requests, so it shares the bulk budget. The
 * risks: a reader losing the text to a bug here, a signed-in reader capped by a notice
 * that can only ask them to sign in, and prefetches burning a reader's allowance.
 */
const state = vi.hoisted(() => ({
  identity: { kind: 'anon' } as Record<string, unknown>,
  allowed: true,
  throws: false,
  logged: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAccess: async () => {
    if (state.throws) throw new Error('db down');
    return { allowed: false, status: 401, identity: state.identity };
  },
}));
vi.mock('@/lib/api-budget', () => ({ checkPageBudget: async () => ({ allowed: state.allowed }) }));
vi.mock('@/lib/api-usage', () => ({ logApiUsage: (row: Record<string, unknown>) => state.logged.push(row) }));

import { checkReadBudget, chargeRead } from '@/lib/read-budget';

const req = (headers: Record<string, string> = {}) => new NextRequest('https://sourcelibrary.org/book/x/read', { headers });

beforeEach(() => {
  state.identity = { kind: 'anon' };
  state.allowed = true;
  state.throws = false;
  state.logged = [];
});
afterEach(() => { delete process.env.READ_PAGE_BUDGET; });

describe('checkReadBudget', () => {
  it('leaves a caller inside the budget alone, whatever the hourly API limit said', async () => {
    expect((await checkReadBudget(req()))?.overBudget).toBe(false);
  });

  it('sends an anonymous caller over the budget to the sample', async () => {
    state.allowed = false;
    expect((await checkReadBudget(req()))?.overBudget).toBe(true);
  });

  it('caps a signed-in reader past the session budget, and still meters them (Derek, 2026-11-08)', async () => {
    state.allowed = false;
    state.identity = { kind: 'session', userId: 'u1' };
    const meter = await checkReadBudget(req());
    expect(meter?.overBudget).toBe(true);
    chargeRead(meter, 60, 5);
    expect(state.logged).toHaveLength(1);
  });

  it('lets a signed-in reader under the budget read in full', async () => {
    state.allowed = true;
    state.identity = { kind: 'session', userId: 'u1' };
    expect((await checkReadBudget(req()))?.overBudget).toBe(false);
  });

  it('lets the reader through when the check fails', async () => {
    state.throws = true;
    expect(await checkReadBudget(req())).toBeNull();
  });

  it('does not meter a prefetch', async () => {
    state.allowed = false;
    expect(await checkReadBudget(req({ 'next-router-prefetch': '1' }))).toBeNull();
    expect(await checkReadBudget(req({ purpose: 'prefetch' }))).toBeNull();
  });

  it('can be rolled back without a deploy of code', async () => {
    process.env.READ_PAGE_BUDGET = 'off';
    state.allowed = false;
    expect(await checkReadBudget(req())).toBeNull();
  });
});

describe('chargeRead', () => {
  it('writes the row the budget sums', async () => {
    chargeRead(await checkReadBudget(req()), 60, 12);
    expect(state.logged[0]).toMatchObject({ route: 'book_read', pagesServed: 60, blocked: false, status: 200 });
  });

  it('marks a row that fell back to the sample', async () => {
    state.allowed = false;
    chargeRead(await checkReadBudget(req()), 20, 12);
    expect(state.logged[0]).toMatchObject({ blocked: true, reason: 'read_page_budget', pagesServed: 20 });
  });

  it('does nothing without a meter', () => {
    chargeRead(null, 60, 12);
    expect(state.logged).toEqual([]);
  });
});
