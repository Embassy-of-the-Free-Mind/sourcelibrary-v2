/**
 * #7809: lanes check the routes they run against the current router table's decisions.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { checkBinding, servedByFirstRead, servedByCorrect, servedByReread, servedByArmcFirstRead, loadCurrentTable } from '../../scripts/lib/router-binding.mjs';
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
  it('a correct line with --reread-per-call serves the re-read cells, print only (#7853)', () => {
    expect(servedByCrontab('50 */2 * * * f=/root/sourcelibrary/scripts/batch/cli-ocr-lane.mjs; node $f correct --out=/x --reread-per-call=4 --agy-home=default --apply')).toEqual([
      { lane: 'reread', cell: 'german-lite/print', route: 'agy-flash-low@4-read' },
      { lane: 'reread', cell: 'french-lite/print', route: 'agy-flash-low@4-read' },
    ]);
  });
});

describe('servedByReread (#7853)', () => {
  it('the route id from the pages a call; the print cells only (the writer runs --print-only)', () => {
    expect(servedByReread({ languages: ['German'], perCall: 4 })).toEqual([{ lane: 'reread', cell: 'german-lite/print', route: 'agy-flash-low@4-read' }]);
    expect(servedByReread({ languages: ['French'], perCall: 1 })).toEqual([{ lane: 'reread', cell: 'french-lite/print', route: 'agy-flash-low-read' }]);
  });
});

describe('current.json `cells`: the pointer moved for named cells only (#7853)', () => {
  it('a named cell takes its row from its own build; every other cell stays on `table`', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
    const w = (n: string, o: unknown) => fs.writeFileSync(path.join(dir, n), JSON.stringify(o));
    w('old.json', { rows: [row('a/print', 'keep', 'x'), row('b/print', 'HOLD', 'y')] });
    w('new.json', { rows: [row('a/print', 'switch', 'z'), row('b/print', 'switch', 'w')] });
    w('current.json', { table: 'old', cells: { 'b/print': { table: 'new', set: '2026-11-01', why: 't' } } });
    const t = loadCurrentTable(dir);
    expect([t.rows.get('a/print').route, t.rows.get('b/print').route, t.rows.get('b/print').table]).toEqual(['x', 'w', 'new']);
    const f = checkBinding(t, [{ lane: 'l', cell: 'b/print', route: 'w' }])[0];
    expect([f.status, f.table]).toEqual(['ok', 'new']);
    w('current.json', { table: 'old', cells: { 'c/print': { table: 'new' } } });
    expect(() => loadCurrentTable(dir)).toThrow(/no cell c\/print/);
    fs.rmSync(dir, { recursive: true, force: true });
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
  it('the re-read mode (#7853): French read@4 is the decided route; German runs on the dated reread waiver (the Opus bar keeps lite>opus)', () => {
    const f = checkBinding(loadCurrentTable(), servedByReread({ languages: ['German', 'French'], perCall: 4 }), { today: '2026-11-01' });
    expect(f.map((x: { cell: string; status: string }) => [x.cell, x.status])).toEqual([['german-lite/print', 'waived'], ['french-lite/print', 'ok']]);
    expect(f[0].waiver).toMatchObject({ lane: 'reread', until: '2026-11-14' });
    expect(f[1]).toMatchObject({ decided: 'agy-flash-low@4-read', table: '2026-11-01-reread-7853' });
    // the waiver is the reread lane's: after its date the German cell is a mismatch again, and pages
    expect(checkBinding(loadCurrentTable(), servedByReread({ languages: ['German'], perCall: 4 }), { today: '2026-11-15' })[0].status).toBe('mismatch');
  });
});

describe('the defect rule decides, k/n is the fallback (#6740)', () => {
  const RT = path.join(__dirname, '../../scripts/eval/estimator/router-table');
  const served = [{ lane: 'first-read', cell: 'german-blank/print', route: 'agy-flash-low@4-written' }];
  it('a k/n fallback is still a decision the lanes are held to; a defect HOLD is not', () => {
    expect(checkBinding(table([row('german-blank/print', 'keep (k/n: the live route x has no defect verdicts)', 'agy-flash-low@4-written')]), served)[0].status).toBe('ok');
    expect(checkBinding(table([row('german-blank/print', 'switch (k/n: no other route has defect verdicts)', 'other')]), served)[0].status).toBe('mismatch');
    expect(checkBinding(table([row('german-blank/print', 'HOLD (defects: the pick moves with the misleads weight, $0.001 → a, $0.01 → b, $0.1 → b)', 'b')]), served)[0].status).toBe('undecided');
  });
  it('the scenario build pins one defect-rule decision and one k/n fallback, each row keeping its k/n decision', () => {
    const t = JSON.parse(fs.readFileSync(path.join(RT, '2026-10-31-defect-rule-6740.json'), 'utf8'));
    const by = Object.fromEntries(t.rows.map((r: { id: string }) => [r.id, r]));
    for (const r of t.rows) expect(r).toHaveProperty('decision_kn');
    // German Flash-Lite correction: the live Opus route has a fifth of agy's wrong text per word; agy fails the gate
    expect([by['german-lite/print'].rule, by['german-lite/print'].decision, by['german-lite/print'].route]).toEqual(['defects', 'keep', 'lite>opus']);
    expect(by['german-lite/print'].defects_rule.gates['lite>agy-flash-low'].wrong_text).toBe(false);
    // Latin Flash-Lite: the live Opus route has 9 books of defect verdicts (< 10): k/n decides, labelled
    expect([by['latin-lite/print'].rule, by['latin-lite/print'].decision]).toEqual(['k/n', 'keep (k/n: the live route lite>opus has no defect verdicts (9 books))']);
  });
  const py = spawnSync('python3', ['--version']);
  it.skipIf(py.status !== 0)('build.py decide_defects: switch, gates, the weight HOLD and every fallback (test_pick.py DefectRule)', () => {
    const r = spawnSync('python3', ['-m', 'unittest', 'test_pick.DefectRule'], { cwd: RT, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });
});
