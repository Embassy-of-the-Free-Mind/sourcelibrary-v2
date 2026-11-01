/**
 * #7263 (router-optimization-paper.md build step 5): the router-table drift report and the V4 confirmation verdict.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { driftReport, driftMarkdown } from '../../scripts/audit/router-table-drift.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { v4Verdict, routeRunner, currentRoute, frameFor } from '../../scripts/eval/router-confirm/confirm.mjs';

type Row = { id: string; decision: string; route: string; pages_waiting: number; routes: { id: string; k: number; n: number }[]; before?: string; current?: string };
const row = (id: string, decision: string, route: string, pages_waiting = 0): Row => ({ id, decision, route, pages_waiting, routes: [{ id: route, k: 9, n: 10 }] });
const table = (rows: Row[], waivers: unknown[] = []) => ({ name: 't', rows: new Map(rows.map((r) => [r.id, r])), waivers, pointer: { set: '2026-10-31' } });
const CORRECT_LINE = '0 * * * * node scripts/batch/cli-ocr-lane.mjs correct --max-pages=10';

describe('driftReport: has each decided cell shipped?', () => {
  const rows = [
    row('german-lite/unknown', 'switch', 'lite>agy-flash-low', 0),
    row('french-lite/print', 'switch', 'agy-flash-low@4-read', 1000),
    row('latin-lite/print', 'keep', 'lite>opus', 5000),
    row('russian-lite/unknown', 'switch', 'agy-flash-low-read', 0),
    row('tibetan-yigdzin/print', 'keep (UNTESTED)', 'yigdzin>opus', 50),
    row('italian-lite/print', 'HOLD', 'lite', 99),
  ];
  const r = driftReport({ table: table(rows), crontabs: { 'infrastructure/gex45-crontab': CORRECT_LINE }, routingTables: { 'ocr-routing-table.json': { text: '{}', as_of: '2026-10-26', changed: '2026-10-26' } }, today: '2026-11-01' });
  const by = Object.fromEntries(r.cells.map((c: { cell: string; status: string }) => [c.cell, c.status]));

  it('gives every keep / switch cell one status; UNTESTED keeps and HOLDs are not decisions', () => {
    expect(by).toEqual({ 'german-lite/unknown': 'served', 'french-lite/print': 'mismatch', 'latin-lite/print': 'unshipped', 'russian-lite/unknown': 'idle' });
  });
  it('counts the pages a decision without a lane leaves waiting, and dates the routing tables against the pointer', () => {
    expect(r.tally.unshipped).toEqual({ cells: 1, pages_waiting: 5000 });
    expect(r.routing_tables[0].days_behind_pointer).toBe(5);
  });
  it('the signature changes only when a non-served cell changes (the nightly comment posts on change)', () => {
    expect(r.signature).toBe('latin-lite/print:unshipped:lite>opus|french-lite/print:mismatch:agy-flash-low@4-read');
    expect(driftMarkdown(r)).toContain('| latin-lite/print | keep → lite>opus | 5,000 | **unshipped** | none |');
  });
  it('a live waiver turns a mismatch into waived', () => {
    const w = driftReport({ table: table(rows, [{ cell: 'french-lite/print', set: '2026-11-01', until: '2026-11-10', reason: 'test' }]), crontabs: { x: CORRECT_LINE }, routingTables: {}, today: '2026-11-01' });
    expect(w.cells.find((c: { cell: string }) => c.cell === 'french-lite/print').status).toBe('waived');
  });
});

describe('V4 confirmation: the verdict set before the data', () => {
  const rule = { within: 0.08, wrong_text_max: 0.04 };
  const pair = (w: boolean, c: boolean, ww = false, cw = false) => ({ win: { accept: w, wrong: ww }, cur: { accept: c, wrong: cw } });
  const many = (n: number, p: ReturnType<typeof pair>) => Array.from({ length: n }, () => p);

  it('PASS when the winner is within the margin and its wrong text within the allowance', () => {
    const v = v4Verdict([...many(26, pair(true, true)), pair(false, true), pair(true, false), ...many(2, pair(false, false))], [{ accept: false }, { accept: false }], rule);
    expect(v.verdict).toBe('PASS');
    expect(v.d).toBe(0);
    expect([v.gained, v.lost]).toEqual([1, 1]);
  });
  it('FAIL when the winner loses more than the margin', () => {
    const v = v4Verdict([...many(24, pair(true, true)), ...many(3, pair(false, true)), ...many(3, pair(false, false))], [], rule);
    expect(v.verdict).toBe('FAIL');
    expect(v.d).toBeCloseTo(-0.1);
  });
  it('FAIL on wrong text even when acceptance ties', () => {
    const v = v4Verdict([...many(28, pair(true, true)), ...many(2, pair(false, false, true, false))], [], rule);
    expect(v.verdict).toBe('FAIL');
  });
  it('VOID when a wrong-page control is accepted, or too many pairs lack verdicts', () => {
    expect(v4Verdict(many(30, pair(true, true)), [{ accept: true }], rule).verdict).toBe('VOID');
    expect(v4Verdict([...many(26, pair(true, true)), null, null, null, null], [], rule).verdict).toBe('VOID');
  });
});

describe('V4 harness: routes, frames, the current route', () => {
  it('runs the stored text, the #7558 correction and fresh agy reads; nothing else', () => {
    expect(routeRunner('agy-flash-low@4-read')).toEqual({ kind: 'read', per_call: 4, calls_per_page: 1 });
    expect(routeRunner('lite>agy-flash-low')?.kind).toBe('correct');
    expect(routeRunner('yigdzin>agy-flash-low')).toBeNull();
    expect(frameFor('french-lite/print')).toMatchObject({ base: 'french-lite', script: 'print' });
    expect(frameFor('tibetan-yigdzin/manuscript')).toBeNull();
  });
  it('the current route is the serving cron lane, else the table route before the switch', () => {
    const r = { ...row('french-lite/print', 'switch', 'agy-flash-low@4-read'), before: 'HOLD → lite>agy-flash-low', current: 'lite>opus' };
    expect(currentRoute(r, [{ cell: 'french-lite/print', route: 'lite>agy-flash-low' }]).route).toBe('lite>agy-flash-low');
    expect(currentRoute(r, []).route).toBe('lite>agy-flash-low');
    expect(currentRoute({ ...r, before: undefined }, []).route).toBe('lite>opus');
  });
});
