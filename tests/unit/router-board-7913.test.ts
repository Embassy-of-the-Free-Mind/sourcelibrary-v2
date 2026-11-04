/**
 * /admin/router (#7913): the board pushed by scripts/maintenance/router-board-push.mjs, built from the drift audit.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { routerBoard, cronLanes, routeEvidence } from '../../scripts/maintenance/router-board-push.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { driftReport } from '../../scripts/audit/router-table-drift.mjs';
import { ageMin, daysLeft, splitCells, type RouterCell } from '@/lib/router-board';

const row = (id: string, decision: string, route: string, pages = 0, extra: object = {}) => ({
  id, decision, route, pages_waiting: pages, title: id,
  routes: [{ id: route, k: 9, n: 10, mean: 0.85, wrong: 1, eff: [9, 10, 1], defects: { books: 12, words: 5000, misleads_per_1k_posterior: [1, 2, 3], wrong_text_per_1k_posterior: [0.1, 0.2, 0.3] } }],
  ...extra,
});
const table = (rows: ReturnType<typeof row>[], waivers: unknown[] = []) => ({ name: 't', rows: new Map(rows.map((r) => [r.id, r])), waivers, pointer: { set: '2026-11-01' } });
const CORRECT = '50 */2 * * * cd /root/sl && node scripts/batch/cli-ocr-lane.mjs correct --apply --out=/x  # #7558 main pool';

function board(t: ReturnType<typeof table>, crontabs: Record<string, string>, today = '2026-11-02') {
  const drift = driftReport({ table: t, crontabs, routingTables: {}, today });
  return routerBoard({ table: t, drift, lanes: cronLanes(crontabs), today });
}

describe('router-board-push', () => {
  it('a lane gets its box, schedule and comment; served / mismatch from the binding check', () => {
    const lanes = cronLanes({ 'infrastructure/gex45-crontab': `# a comment line with cli-ocr-lane.mjs\n${CORRECT}` });
    expect(lanes.length).toBeGreaterThan(0);
    expect(lanes[0]).toMatchObject({ lane: 'correct', route: 'lite>agy-flash-low', box: 'infrastructure/gex45-crontab', schedule: '50 */2 * * *', comment: '#7558 main pool' });
    const b = board(table([row('german-lite/print', 'switch', 'lite>agy-flash-low', 100), row('french-lite/print', 'keep', 'lite>opus', 50)]), { 'infrastructure/gex45-crontab': CORRECT });
    const by = Object.fromEntries(b.cells.map((c: RouterCell) => [c.cell, c]));
    expect(by['german-lite/print'].status).toBe('served');
    expect(by['german-lite/print'].lanes[0]).toMatchObject({ box: 'gex45-crontab', schedule: '50 */2 * * *', status: 'ok' });
    expect(by['french-lite/print'].status).toBe('mismatch');
    expect(by['french-lite/print'].production).toEqual(['lite>agy-flash-low']);
    expect(b.cells[0].cell).toBe('french-lite/print');   // worst first
  });

  it('a decided cell no lane runs is unshipped; an undecided cell is listed only with a lane or pages waiting', () => {
    const b = board(table([row('latin-lite/print', 'keep', 'lite>opus', 835238), row('x/print', 'HOLD', 'lite', 0), row('y/print', 'NEEDS-ENGINE (engine)', 'lite', 7)]), {});
    expect(b.cells.map((c: RouterCell) => [c.cell, c.status])).toEqual([['latin-lite/print', 'unshipped'], ['y/print', 'undecided']]);
  });

  it('carries the evidence, the judge stratum and the waivers with their expiry', () => {
    const t = table([row('german-lite/print', 'keep', 'lite>opus', 9, { judge_validity: { stratum: 'ocr/print', self_preference_valid: true } })],
      [{ cell: 'german-lite/print', lane: 'correct', set: '2026-10-31', until: '2026-11-14', reason: 'r' }, { cell: 'german-lite/print', set: '2026-10-01', until: '2026-10-10', reason: 'old' }]);
    const c = board(t, { 'infrastructure/gex45-crontab': CORRECT }).cells[0];
    expect(c.status).toBe('waived');
    expect(c.evidence).toMatchObject({ k_of_n: '9/10', n_eff: 10, wrong_text_pages: '1/10', defects: { books: 12, misleads_per_1k: 2, wrong_text_per_1k: 0.2 } });
    expect(c.judge).toEqual({ stratum: 'ocr/print', valid: true });
    expect(c.waivers.map((w: { live: boolean }) => w.live)).toEqual([true, false]);
    expect(routeEvidence(row('a', 'keep', 'r'), 'other')).toBeNull();
  });
});

describe('src/lib/router-board', () => {
  it('age, waiver days, decided / undecided split', () => {
    expect(ageMin({ generated_at: '2026-11-02T10:00:00Z' }, new Date('2026-11-02T12:30:00Z'))).toBe(150);
    expect(ageMin(null)).toBeNull();
    expect(daysLeft('2026-11-14', '2026-11-02')).toBe(12);
    expect(daysLeft('2026-11-01', '2026-11-02')).toBe(-1);
    const s = splitCells([{ status: 'served' }, { status: 'undecided' }, { status: 'idle' }] as RouterCell[]);
    expect([s.decided.length, s.undecided.length]).toEqual([2, 1]);
  });
});
