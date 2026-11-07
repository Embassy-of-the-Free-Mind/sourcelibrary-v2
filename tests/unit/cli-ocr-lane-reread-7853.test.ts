/**
 * #7853: the re-read mode of the stored-lite lane (`cli-ocr-lane.mjs correct --reread-per-call=4`) — the same page
 * selector as the correction, read fresh 4 a call, written by the plain apply stamped with REREAD_LANE, and never
 * re-read twice (the selector refuses the stamp the writer puts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { REREAD_LANE, CORRECT_LANE, CORRECT_MODEL, LITE_MODELS, parseRereadPerCall, rereadRoute, rereadMode, rereadReadArgs, rereadApplyArgs, correctablePageMatch, liveReaderBooks } from '../../scripts/batch/cli-ocr-lane.mjs';

const SKIP = ['blank', 'plate'];
const now = Date.parse('2026-11-01T12:00:00Z');
const b = (weekly: number, five = 0.9) => [{ id: 'gemini-weekly', remaining_fraction: weekly, reset_time: '2026-11-05T22:00:00Z' }, { id: 'gemini-5h', remaining_fraction: five, reset_time: '2026-11-01T16:00:00Z' }];

/** The few operators correctablePageMatch uses, evaluated on one page document (a test oracle, not a Mongo). */
function matches(q: Record<string, any>, doc: Record<string, any>): boolean {
  const get = (p: string) => p.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), doc);
  return Object.entries(q).every(([k, c]) => {
    if (k === '$or') return (c as any[]).some((s) => matches(s, doc));
    if (k === '$and') return (c as any[]).every((s) => matches(s, doc));
    const v = get(k);
    if (c === null) return v == null;   // Mongo: null matches a missing field too
    if (typeof c !== 'object' || c instanceof RegExp) return c instanceof RegExp ? c.test(v) : v === c;
    return Object.entries(c).every(([op, x]: [string, any]) => {
      if (op === '$in') return x.includes(v);
      if (op === '$nin') return !x.includes(v);
      if (op === '$ne') return v !== x;
      if (op === '$exists') return (v !== undefined) === x;
      if (op === '$type') return x === 'string' ? typeof v === 'string' : true;
      if (op === '$gt') return v > x;
      throw new Error(`oracle: no ${op}`);
    });
  });
}

describe('--reread-per-call (#7853)', () => {
  it('is 1 to 4 a call, absent means the correction', () => {
    expect(parseRereadPerCall(undefined)).toBeNull();
    expect(parseRereadPerCall('4')).toBe(4);
    expect(parseRereadPerCall('1')).toBe(1);
    for (const bad of ['0', '5', '2.5', 'x']) expect(() => parseRereadPerCall(bad)).toThrow(/1 to 4/);
  });
  it('names the router route it serves', () => {
    expect(rereadRoute(4)).toBe('agy-flash-low@4-read');
    expect(rereadRoute(1)).toBe('agy-flash-low-read');
  });
  it('runs on the Gemini floor only: no Claude fallback when the pool is empty', () => {
    expect(rereadMode({ buckets: b(0.9), now })).toMatchObject({ mode: 'reread', model: CORRECT_MODEL, lane: REREAD_LANE });
    expect(rereadMode({ buckets: b(0), now }).mode).toBeNull();
    expect(rereadMode({ buckets: b(0.9, 0.1), now }).mode).toBeNull();
    expect(rereadMode({ buckets: null, now }).mode).toBeNull();
  });
});

describe('the re-read takes the correction\'s pages (#7853 selector)', () => {
  const page = ({ ocr, ...rest }: Record<string, any> = {}) => ({ book_id: 'B', page_number: 40, ...rest, ocr: { model: LITE_MODELS[0], data: 'x'.repeat(400), ...(ocr || {}) } });
  const q = correctablePageMatch('B', SKIP);
  it('a stored Flash-Lite page of the book is selected', () => {
    expect(matches(q, page())).toBe(true);
    expect(matches(q, page({ ocr: { model: LITE_MODELS[1] } }))).toBe(true);
  });
  it('the correction\'s exclusions hold: edited, manual, withheld, skipped page type, other book, other model', () => {
    expect(matches(q, page({ ocr: { edited_by: 'derek' } }))).toBe(false);
    expect(matches(q, page({ ocr: { source: 'manual' } }))).toBe(false);
    expect(matches(q, page({ translation_withheld: true }))).toBe(false);
    expect(matches(q, page({ page_type: 'plate' }))).toBe(false);
    expect(matches(q, page({ book_id: 'C' }))).toBe(false);
    expect(matches(q, page({ ocr: { model: 'gemini-3.8-flash-low' } }))).toBe(false);
  });
  it('a page the #7558 correction left (UNCHANGED keeps the lite text and its stamp) is still selected', () => {
    expect(matches(q, page({ ocr: { pipeline: 'some-lite-batch' } }))).toBe(true);
  });
  it('idempotent: the stamp the re-read writes is the marker the selector refuses, even on a Flash-Lite model', () => {
    const apply = rereadApplyArgs({ cli: 'cli-ocr.mjs', ids: '/d/B/ids.json', dir: '/d/B', reason: 'r', apply: true });
    const stamp = apply.find((a: string) => a.startsWith('--lane='))!.slice('--lane='.length);
    expect(stamp).toBe(REREAD_LANE);
    expect(matches(q, page({ ocr: { pipeline: stamp } }))).toBe(false);
    // what a re-read page looks like after the write: the agy model and the stamp
    expect(matches(q, page({ ocr: { model: CORRECT_MODEL, pipeline: stamp } }))).toBe(false);
  });
});

describe('the re-read reads and writes through the read path (#7853)', () => {
  it('reader: the plain read 4 a call, kept reads reused, quota stop; no correction template, no draft', () => {
    const a = rereadReadArgs({ cli: 'cli-ocr.mjs', ids: '/d/B/ids.json', dir: '/d/B', job: 'j', perCall: 4 });
    expect(a.slice(0, 2)).toEqual(['cli-ocr.mjs', 'read']);
    expect(a).toEqual(expect.arrayContaining(['--page-ids-file=/d/B/ids.json', '--out=/d/B', `--model=${CORRECT_MODEL}`, '--per-call=4', '--stop-on-quota', `--lane=${REREAD_LANE}`]));
    expect(a.some((x: string) => /^--(correct-prompt|draft-file|gpu-draft|fresh)/.test(x))).toBe(false);
    expect(rereadReadArgs({ cli: 'c', ids: 'i', dir: 'd', job: 'j', perCall: 1 }).some((x: string) => x.startsWith('--per-call'))).toBe(false);
  });
  it('writer: the plain apply on this chunk only, print only, stamped and flagged; dry unless --apply', () => {
    const w = rereadApplyArgs({ cli: 'cli-ocr.mjs', ids: '/d/B/ids.json', dir: '/d/B', reason: 'route agy-flash-low@4-read', apply: false });
    expect(w).toEqual(['cli-ocr.mjs', 'apply', '--out=/d/B', '--only=/d/B/ids.json', '--reason=route agy-flash-low@4-read', `--lane=${REREAD_LANE}`, '--print-only', `--mark-stale=${REREAD_LANE}`]);
    expect(rereadApplyArgs({ cli: 'c', ids: 'i', dir: 'd', reason: 'r', apply: true }).at(-1)).toBe('--apply');
    // the plain apply's 40% floor and guards are lifted only by --lane-gate / --by-eye / --first-read-only, never passed
    expect(w.some((x: string) => /^--(lane-gate|by-eye|first-read-only)/.test(x))).toBe(false);
  });
  it('a book a re-read or correction reader is on now is skipped by both modes', () => {
    const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'));
    const put = (pid: string, argv: string[]) => { fs.mkdirSync(path.join(proc, pid)); fs.writeFileSync(path.join(proc, pid, 'cmdline'), argv.join('\0') + '\0'); };
    put('21', ['node', '/r/scripts/batch/cli-ocr.mjs', 'read', '--page-ids-file=/d/bookR/page-ids-1.json', `--lane=${REREAD_LANE}`, '--per-call=4']);
    put('22', ['node', '/r/scripts/batch/cli-ocr.mjs', 'read', '--page-ids-file=/d/bookC/page-ids-1.json', `--lane=${CORRECT_LANE}`]);
    expect([...liveReaderBooks(proc)].sort()).toEqual(['bookC', 'bookR']);
    fs.rmSync(proc, { recursive: true, force: true });
  });
});
