/**
 * #7809: lanes check the routes they run against the current router table's decisions.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { checkBinding, servedByFirstRead, servedByCorrect, servedByArmcFirstRead, loadCurrentTable } from '../../scripts/lib/router-binding.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { servedByCrontab } from '../../scripts/audit/router-binding.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { FIRST_READ_PER_CALL_LANGUAGES } from '../../scripts/batch/cli-ocr-lane.mjs';

const row = (id: string, decision: string, route: string) => ({ id, decision, route, routes: [{ id: route, k: 9, n: 10 }] });
const table = (rows: ReturnType<typeof row>[], waivers: unknown[] = []) => ({ name: 't', rows: new Map(rows.map((r) => [r.id, r])), waivers });
const PCL = ['lat', 'deu', 'fra'];

describe('servedByFirstRead: the route id from the lane flags', () => {
  it('per-call only for the per-call languages, the correction pass only where --correct names the language', () => {
    expect(servedByFirstRead({ languages: ['deu', 'ita'], correct: ['deu'], perCall: 4, perCallLanguages: PCL })).toEqual([
      { lane: 'first-read', cell: 'german-blank/print', route: 'agy-flash-low@4>agy-flash-low-written' },
      { lane: 'first-read', cell: 'italian-blank/print', route: 'agy-flash-low-written' },
    ]);
  });
  it('refuses to guess the per-call languages', () => {
    expect(() => servedByFirstRead({ languages: ['deu'] } as never)).toThrow(/FIRST_READ_PER_CALL_LANGUAGES/);
  });
});

describe('checkBinding', () => {
  const served = [{ lane: 'first-read', cell: 'german-blank/print', route: 'agy-flash-low@4-written' }];
  it('ok when the lane runs the decided route', () => {
    expect(checkBinding(table([row('german-blank/print', 'switch', 'agy-flash-low@4-written')]), served)[0].status).toBe('ok');
  });
  it('mismatch when a keep/switch decision names another route', () => {
    expect(checkBinding(table([row('german-blank/print', 'switch', 'agy-flash-low@4>agy-flash-low-written')]), served)[0].status).toBe('mismatch');
  });
  it('a HOLD, UNTESTED or planned cell is undecided, never a mismatch', () => {
    for (const d of ['HOLD', 'HOLD (manuscript: < 10 pages a route)', 'UNTESTED (manuscript)', 'keep (UNTESTED)', 'planned']) {
      expect(checkBinding(table([row('german-blank/print', d, 'other')]), served)[0].status).toBe('undecided');
    }
  });
  it('no-cell when the table has no such cell', () => {
    expect(checkBinding(table([]), served)[0].status).toBe('no-cell');
  });
  it('a waiver holds until its date, at most 14 days, and needs a reason', () => {
    const r = [row('german-blank/print', 'switch', 'x')];
    const w = { cell: 'german-blank/print', set: '2026-10-30', until: '2026-11-06', reason: 'capacity' };
    expect(checkBinding(table(r, [w]), served, { today: '2026-11-01' })[0].status).toBe('waived');
    expect(checkBinding(table(r, [w]), served, { today: '2026-11-07' })[0].status).toBe('mismatch');
    expect(checkBinding(table(r, [{ ...w, until: '2026-12-30' }]), served, { today: '2026-11-01' })[0].status).toBe('mismatch');
    expect(checkBinding(table(r, [{ ...w, reason: '' }]), served, { today: '2026-11-01' })[0].status).toBe('mismatch');
    expect(checkBinding(table(r, [{ ...w, lane: 'correct' }]), served, { today: '2026-11-01' })[0].status).toBe('mismatch');
  });
});

describe('servedByCrontab', () => {
  const cron = [
    '#OCRFIRST-7701 50 * * * * f=/root/sourcelibrary/scripts/batch/cli-ocr-lane.mjs; node $f correct --out=/x --apply',
    '50 * * * * f=/root/sourcelibrary/scripts/batch/cli-ocr-lane.mjs; node $f run --cohort=visible-unread --languages=deu,fra --per-call=4 --out=/x --apply',
    '20 * * * * f=/root/sourcelibrary/scripts/batch/cli-ocr-lane.mjs; node $f run --cohort=visible-unread --languages=deu,fra --per-call=4 --out=/x --agy-home=/root/.agy-james --apply',
    '35 * * * * f=/root/sourcelibrary/scripts/batch/cli-ocr-lane.mjs; sh -c "node $f armc-plan --frame=first-read --langs=la && node $f armc --frame=first-read --langs=la --apply"',
  ].join('\n');
  it('reads live lines only, one finding per lane and cell', () => {
    expect(servedByCrontab(cron)).toEqual([
      { lane: 'first-read', cell: 'german-blank/print', route: 'agy-flash-low@4-written' },
      { lane: 'first-read', cell: 'french-blank/print', route: 'agy-flash-low@4-written' },
      { lane: 'armc-first-read', cell: 'latin-blank/print', route: 'pero>agy-flash-low-written' },
    ]);
  });
  it('a correct line serves the correction cells', () => {
    expect(servedByCrontab('10 * * * * node scripts/batch/cli-ocr-lane.mjs correct --out=/x').map((s: { cell: string }) => s.cell))
      .toEqual(servedByCorrect({ languages: ['German', 'French'] }).map((s: { cell: string }) => s.cell));
  });
});

describe('the committed pointer', () => {
  it('names a table that exists and has rows', () => {
    const t = loadCurrentTable();
    expect(t.rows.size).toBeGreaterThan(0);
  });
  it('the live first-read and arm-c routes match the current table (2026-10-30 gex45 crontab)', () => {
    const served = [...servedByFirstRead({ languages: ['deu', 'fra'], perCall: 4, perCallLanguages: FIRST_READ_PER_CALL_LANGUAGES }), ...servedByArmcFirstRead({ langs: ['la'] })];
    expect(checkBinding(loadCurrentTable(), served).map((f: { status: string }) => f.status)).toEqual(['ok', 'ok', 'ok']);
  });
});
