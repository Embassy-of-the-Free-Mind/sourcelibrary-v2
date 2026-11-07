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
  waivers: [{ lane: 'correct', set: '2026-10-31', until: '2026-11-14', live: true, reason: 'r' }], routing_row: true, ...extra,
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
    expect(html).not.toContain('pusher (router-board-push.mjs) is down');
  });

  it('no push: says so in red', async () => {
    const { default: Page } = await import('@/app/admin/router/page');
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('no push yet');
    expect(html).toContain('is down');
  });
});
