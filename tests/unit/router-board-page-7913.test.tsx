/**
 * /admin/router (#7913): the page renders the pushed board (decided cells first, the stale line in red), and says so
 * when there is no push. getRouterBoard is mocked: no Mongo in this suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state: { doc: unknown } = { doc: null };
vi.mock('@/lib/mongodb', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/router-board', async (orig) => ({ ...(await orig<typeof import('@/lib/router-board')>()), getRouterBoard: async () => state.doc }));

const cell = (cell: string, status: string, extra: object = {}) => ({
  cell, title: cell, status, decision: 'keep', decision_label: 'keep (k/n: why)', route: 'lite>opus', table: 't', decided_set: '2026-11-01',
  evidence: { route: 'lite>opus', k_of_n: '299/307', n: 307, n_eff: 40, accept_mean: 0.95, wrong_text_pages: '8/307', defects: null },
  judge: { stratum: 'ocr/print', valid: true }, pages_waiting: 409596, production: ['lite>agy-flash-low'],
  lanes: [{ box: 'gex45-crontab', lane: 'correct', runs: 'lite>agy-flash-low', runs_kn: '108/132', status: 'waived', schedule: '50 */2 * * *', comment: '#7558', waiver_until: '2026-11-14' }],
  waivers: [{ lane: 'correct', set: '2026-10-31', until: '2026-11-14', live: true, reason: 'r' }], routing_row: true,
  routes: [
    { id: 'lite>opus', stage: 'opus-img@10', lane: null, tested: true, k: 299, n: 307, rate: 0.959, ci90: [0.916, 0.988], wrong_text: 7, invented_or_wrong_leaf: null, hard_floor_block: false, written_of_drawn: null, paired: null,
      defects: { books: 30, words: 9000, misleads_per_1k: [0.8, 1.319, 2], wrong_text_per_1k: [0.05, 0.2, 0.4] }, cost: { unit: 'pts', low: 0.0041, mid: 0.0043, high: 0.0045 }, in_use: false, decided: true },
    { id: 'lite>agy-flash-low+diffqa', stage: 'agy', lane: null, tested: false, k: null, n: null, rate: 0.875, ci90: [0.593, 0.998], wrong_text: null, invented_or_wrong_leaf: null, hard_floor_block: false, written_of_drawn: null, paired: null,
      defects: null, cost: { unit: 'agy calls', low: 1.2, mid: 2.873, high: 6 }, in_use: true, decided: false },
  ], ...extra,
});

describe('/admin/router page', () => {
  beforeEach(() => { state.doc = null; });

  it('renders decided cells, lanes with box and schedule, and the waiver expiry', async () => {
    state.doc = {
      _id: 'router-board:latest', type: 'router-board', generated_at: new Date(Date.now() - 5 * 60000), commit: 'abc123', as_of: '2026-11-02',
      table: '2026-11-01-validated-7263', pointer_set: '2026-11-01', crontabs: ['infrastructure/gex45-crontab'],
      tally: { waived: { cells: 1, pages_waiting: 409596 } }, routing_tables: [{ file: 'scripts/lib/ocr-routing-table.json', as_of: null, changed: '2026-11-02', days_behind_pointer: 0 }],
      cells: [cell('german-lite/print', 'waived'), cell('zh/print', 'undecided', { lanes: [], waivers: [] })],
    };
    const { default: Page } = await import('@/app/admin/router/page');
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('german-lite/print');
    expect(html).toContain('50 */2 * * *');
    expect(html).toContain('299/307');
    expect(html).toContain('until 2026-11-14');
    expect(html).toContain('Undecided cells with a lane or pages waiting (1');
    expect(html).toContain('from abc123');
    // every route (#240): measured k/n and interval, an untested route's prior labelled as one, cost per accepted page
    expect(html).toContain('299 of 307');
    expect(html).toContain('0.96 <span class="text-stone-500">[0.92, 0.99]</span>');
    expect(html).toContain('prior 0.88 [0.59, 1.00]');
    expect(html).toContain('2.87 agy calls');
    expect(html).toContain('router&#x27;s pick');
    expect(html).toContain('in use');
    // the quality loop strip (#244)
    expect(html).toContain('aria-label="Quality loop"');
    expect(html).not.toContain('pusher (router-board-push.mjs) is down');
  });

  it('stale routes (v3#460): one block at the top, grouped by rule; a push from before says so', async () => {
    const base = {
      _id: 'router-board:latest', type: 'router-board', generated_at: new Date(Date.now() - 5 * 60000), commit: 'abc123', as_of: '2026-11-17',
      table: '2026-11-01-validated-7263', pointer_set: '2026-11-01', crontabs: [], tally: {}, routing_tables: [], cells: [cell('latin-lite/print', 'served')],
    };
    state.doc = { ...base, stale: [{ cell: 'latin-lite/print', rule: 'thin', why: '835K pages waiting on 20/30 judged pages', pages_waiting: 835238 }] };
    const { default: Page } = await import('@/app/admin/router/page');
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('Stale routes (1)');
    expect(html).toContain('thin evidence for a big queue (1)');
    expect(html).toContain('835K pages waiting on 20/30 judged pages');
    expect(html.indexOf('Stale routes (1)')).toBeLessThan(html.indexOf('Decided cells'));
    state.doc = base;
    expect(renderToStaticMarkup(await Page())).toContain('this push predates them');
  });

  it('no push: says so in red', async () => {
    const { default: Page } = await import('@/app/admin/router/page');
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('no push yet');
    expect(html).toContain('is down');
  });
});
