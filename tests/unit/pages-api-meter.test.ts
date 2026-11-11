import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The reader's page routes (/api/pages/[id], /api/pages/batch) served page text to any
 * signed-in account with no budget and no log. The risks guarded here: a signed-in script
 * reading without a cap, a call that leaves no usage row, an editor or partner room capped,
 * and a metering failure costing a reader the page.
 */
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role?: string } },
  used: 0,
  usedThrows: false,
  rows: [] as Record<string, unknown>[],
  usedRoute: undefined as string | undefined,
}));

vi.mock('@/lib/auth', () => ({ auth: async () => state.session }));
vi.mock('@/lib/book-access', () => ({ hasCronAuth: (r: Request) => r.headers.get('authorization') === 'Bearer cron' }));
vi.mock('@/lib/api-usage', () => ({
  getPagesServedLast24h: async (input: { route?: string }) => {
    if (state.usedThrows) throw new Error('db down');
    state.usedRoute = input.route;
    return state.used;
  },
  writeApiUsage: async (row: Record<string, unknown>) => { state.rows.push(row); },
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { fn(); } }));

import { checkPagesApiBudget, recordPagesApi, pagesWithText, PAGES_API_ROUTE } from '@/lib/pages-api-meter';
import { API_LIMITS } from '@/lib/api-limits';

const req = (headers: Record<string, string> = {}) => new NextRequest('https://sourcelibrary.org/api/pages/batch', { method: 'POST', headers });
const LIMIT = API_LIMITS.session.readerPagesPerDay;

beforeEach(() => { state.session = null; state.used = 0; state.usedThrows = false; state.rows = []; state.usedRoute = undefined; });
afterEach(() => { delete process.env.PAGES_API_BUDGET; delete process.env.PAGES_API_LOG; });

describe('checkPagesApiBudget', () => {
  it('caps a signed-in account past the daily reader budget, counted in its own pool', async () => {
    state.session = { user: { id: 'u1' } };
    state.used = LIMIT;
    const m = await checkPagesApiBudget(req());
    expect(m?.overBudget).toBe(true);
    expect(m?.limit).toBe(LIMIT);
    expect(state.usedRoute).toBe(PAGES_API_ROUTE);
  });

  it('lets a signed-in account under the budget read', async () => {
    state.session = { user: { id: 'u1' } };
    state.used = LIMIT - 1;
    expect((await checkPagesApiBudget(req()))?.overBudget).toBe(false);
  });

  it('logs but never caps anonymous callers, editors, partner rooms and the pipeline', async () => {
    state.used = 10 * LIMIT;
    expect((await checkPagesApiBudget(req()))?.capped).toBe(false);
    state.session = { user: { id: 'e1', role: 'editor' } };
    expect((await checkPagesApiBudget(req()))?.overBudget).toBe(false);
    state.session = { user: { id: 'u1' } };
    expect((await checkPagesApiBudget(req(), { exempt: true }))?.overBudget).toBe(false);
    expect((await checkPagesApiBudget(req({ authorization: 'Bearer cron' })))?.overBudget).toBe(false);
  });

  it('never stops a reader when the count fails', async () => {
    state.session = { user: { id: 'u1' } };
    state.usedThrows = true;
    expect(await checkPagesApiBudget(req())).toBeNull();
  });

  it('PAGES_API_BUDGET=off lifts the cap and keeps the log', async () => {
    process.env.PAGES_API_BUDGET = 'off';
    state.session = { user: { id: 'u1' } };
    state.used = 10 * LIMIT;
    const m = await checkPagesApiBudget(req());
    expect(m?.overBudget).toBe(false);
    recordPagesApi(req(), m, { status: 200, pagesServed: 3 });
    expect(state.rows).toHaveLength(1);
  });
});

describe('recordPagesApi', () => {
  it('writes one pages_api row with the pages served and the user', async () => {
    state.session = { user: { id: 'u1' } };
    const m = await checkPagesApiBudget(req());
    recordPagesApi(req(), m, { status: 200, pagesServed: 20 });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ route: PAGES_API_ROUTE, pagesServed: 20, status: 200, identity: { kind: 'session', userId: 'u1' } });
  });
});

describe('pagesWithText', () => {
  it('counts pages that carried OCR or translation, not stripped ones', () => {
    expect(pagesWithText([
      { translation: { data: 'x' } },
      { ocr: { data: 'y' } },
      { translation: { data: '' }, gated: true },
      {},
      null,
    ])).toBe(2);
  });
});
