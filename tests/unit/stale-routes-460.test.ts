/**
 * Stale routes (v3#460): the rules over a router-board document. The cells are trimmed copies of the 2026-11-17 board
 * (router-board:latest at 08:17Z plus the newer-build fields the push now adds), so the test is today's board, and Latin
 * print (decided 2026-11-03 on 30 judged pages, 835K pages waiting) must come out stale.
 */
import { describe, it, expect } from 'vitest';
import { staleRoutes, groupStale, THIN_N, BIG_CELL } from '../../scripts/lib/stale-routes.mjs';

const nb = (decision: string, route: string, n: number | null) => ({ table: '2026-11-14-hydrogen-218', decision, route, n });
const cell = (o: Record<string, unknown>) => ({
  status: 'served', decision: 'keep', route: 'r', table: '2026-11-01-validated-7263', decided_set: '2026-11-01', pages_waiting: 0,
  evidence: null, waivers: [], lanes: [], routes: [], newest_build: null, ...o,
});
const ev = (k: number, n: number) => ({ k_of_n: `${k}/${n}`, n });
const lane = (runs: string, status = 'ok') => ({ box: 'gex45-crontab', lane: 'reread', runs, status });

const TODAY = '2026-11-17';
const board = {
  table: '2026-11-01-validated-7263', pointer_set: '2026-11-01',
  builds_since_pointer: ['2026-11-02-policy-7913', '2026-11-03-latin-v4-7263', '2026-11-13-flash3-8632', '2026-11-14-hydrogen-218'],
  routing_tables: [{ file: 'scripts/lib/ocr-routing-table.json', days_behind_pointer: -15 }, { file: 'scripts/lib/translation-routing-table.json', days_behind_pointer: -14 }],
  cells: [
    cell({ cell: 'latin-lite/print', decision: 'switch', route: 'agy-flash-low@4-read', table: '2026-11-03-latin-v4-7263', decided_set: '2026-11-03', pages_waiting: 835238,
      evidence: ev(20, 30), lanes: [lane('agy-flash-low@4-read')], routes: [{ id: 'lite' }, { id: 'agy-flash-low@4-read' }], newest_build: nb('switch', 'agy-flash-low@4-read', 30) }),
    cell({ cell: 'german-flash3/print', status: 'unshipped', route: '3flash>opus', pages_waiting: 139496, evidence: ev(21, 21), newest_build: nb('keep', '3flash>opus', 21) }),
    cell({ cell: 'german-lite/print', status: 'waived', route: 'lite>opus', pages_waiting: 409596, evidence: ev(299, 307),
      waivers: [{ until: '2026-11-14', live: false, lane: 'correct' }, { until: '2026-11-27', live: true, lane: 'reread' }],
      lanes: [lane('agy-flash-low@4-read', 'waived')], routes: [{ id: 'lite>opus' }, { id: 'agy-flash-low@4-read' }], newest_build: nb('keep', 'lite>opus', 307) }),
    cell({ cell: 'latin-blank/print', status: 'waived', decision: 'switch', route: 'pero>agy-flash-low-written', evidence: ev(18, 18),
      waivers: [{ until: '2026-11-25', live: true, lane: 'first-read' }], lanes: [lane('agy-flash-low@4-written', 'waived')],
      routes: [{ id: 'pero>agy-flash-low-written' }, { id: 'agy-flash-low@4-written' }], newest_build: nb('HOLD', 'pero>agy-flash-low-written', 30) }),
    cell({ cell: 'latin-gpu-7263/print', status: 'idle', decision: 'switch', route: 'pero>agy-flash-low', evidence: ev(105, 108), newest_build: nb('switch', 'pero>agy-flash-low', 229) }),
    cell({ cell: 'english-gpu-7263/print', status: 'idle', decision: 'switch', route: 'gpu2>agy-flash-low+diff', evidence: ev(45, 45), newest_build: nb('switch', 'gpu-glm>agy-flash-low', 45) }),
    cell({ cell: 'latin-flash3/print', status: 'undecided', decision: 'HOLD', route: '3flash>agy-flash-low', pages_waiting: 692318, evidence: ev(47, 60), newest_build: nb('switch', 'pero>agy-flash-low@4', 98) }),
    cell({ cell: 'tamil-lite/print', status: 'undecided', decision: 'HOLD', route: 'lite', pages_waiting: 211, evidence: ev(3, 3) }),
  ],
};

const rulesOf = (list: { cell: string | null; rule: string }[], c: string | null) => list.filter((x) => x.cell === c).map((x) => x.rule);

describe('staleRoutes (v3#460)', () => {
  const list = staleRoutes(board, { today: TODAY });

  it('Latin print is stale: a 30-page test behind an 835K-page queue', () => {
    expect(rulesOf(list, 'latin-lite/print')).toEqual(['thin']);
    expect(list.find((x) => x.cell === 'latin-lite/print')!.why).toContain('20/30');
    expect(30).toBeLessThan(THIN_N);
    expect(835238).toBeGreaterThan(BIG_CELL);
  });

  it('a decided cell no lane runs is a production finding, and a thin one', () => {
    expect(rulesOf(list, 'german-flash3/print')).toEqual(['production', 'thin']);
  });

  it('a waiver is stale only inside its last 7 days; dead waivers beside a live one say nothing', () => {
    expect(rulesOf(list, 'german-lite/print')).toEqual([]);
    expect(rulesOf(staleRoutes(board, { today: '2026-11-21' }), 'german-lite/print')).toEqual(['waiver']);
    expect(staleRoutes(board, { today: '2026-11-21' }).find((x) => x.cell === 'german-lite/print')!.why).toContain('ends 2026-11-27 (in 6 days)');
  });

  it('a newer build that decides otherwise makes the decision stale; more pages for the same decision do not', () => {
    expect(rulesOf(list, 'latin-blank/print')).toEqual(['evidence']);
    expect(list.find((x) => x.cell === 'latin-blank/print')!.why).toContain('decides HOLD on 30 pages of it (the decision had 18)');
    expect(rulesOf(list, 'latin-gpu-7263/print')).toEqual([]);
    // idle: nothing waits and nothing runs, so a different newer route is not worth a line
    expect(rulesOf(list, 'english-gpu-7263/print')).toEqual([]);
  });

  it('a big cell without a decision is listed with what the newest build would do; a small one is not', () => {
    expect(rulesOf(list, 'latin-flash3/print')).toEqual(['undecided']);
    expect(list.find((x) => x.cell === 'latin-flash3/print')!.why).toContain('would switch pero>agy-flash-low@4');
    expect(rulesOf(list, 'tamil-lite/print')).toEqual([]);
  });

  it('a lane running a route the table does not name, or another route unwaived, is production', () => {
    const b = { ...board, cells: [cell({ cell: 'x/print', route: 'a', routes: [{ id: 'a' }], lanes: [lane('b', 'mismatch')], pages_waiting: 10 })] };
    const xs = staleRoutes(b, { today: TODAY }).filter((x) => x.cell === 'x/print');
    expect(xs.map((x) => x.rule)).toEqual(['production', 'production']);
    expect(xs[0].why).toContain('no live waiver');
    expect(xs[1].why).toContain('a route the table does not name');
  });

  it('table-wide: the pointer unmoved for 16 days with newer builds; routing tables ahead of the pointer are fine', () => {
    expect(rulesOf(list, null)).toEqual(['pointer']);
    expect(list.find((x) => x.rule === 'pointer')!.why).toContain('16 days; 4 newer builds');
    const behind = staleRoutes({ ...board, routing_tables: [{ file: 'scripts/lib/ocr-routing-table.json', days_behind_pointer: 3 }] }, { today: TODAY });
    expect(rulesOf(behind, null)).toEqual(['tables', 'pointer']);
  });

  it('orders by rule, then the biggest queue; groups keep that order', () => {
    expect(list.map((x) => x.rule)).toEqual(['production', 'evidence', 'thin', 'thin', 'undecided', 'pointer']);
    expect(list.filter((x) => x.rule === 'thin').map((x) => x.cell)).toEqual(['latin-lite/print', 'german-flash3/print']);
    expect(Object.keys(groupStale(list))).toEqual(['production', 'evidence', 'thin', 'undecided', 'pointer']);
  });

  it('an empty or missing board gives no findings, never a throw', () => {
    expect(staleRoutes(null as never)).toEqual([]);
    expect(staleRoutes({ cells: [] } as never)).toEqual([]);
  });
});
