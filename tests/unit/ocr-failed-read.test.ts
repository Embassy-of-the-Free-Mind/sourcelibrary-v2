import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FAILED_READ_REASONS, failedReadStamp, failedReadFilter, failedReadUpdate, recordFailedReads, errorReason,
  fromErrFile, fromCliRead, fromKrakenFail, fromTextless, fromGuardedRead, reasonFromFlags,
// @ts-expect-error — plain .mjs module
} from '../../scripts/lib/ocr-failed-read.mjs';
// @ts-expect-error — plain .mjs module
import { PADDLE } from '../../scripts/lib/paddle-zh-lane.mjs';

/**
 * Every OCR writer records a failed read in one shape (#7378). Until then only the two Gemini API writers did, and the
 * route census read 0 of n for every other route. These tests pin the shape, the mapping each writer uses from what it
 * already knows about a failed page, and the fact that each writer calls the helper at all. The writers run main() on
 * import, so the last part is a source check (as ocr-write-paths-guarded.test.ts does).
 */

const AT = new Date('2026-10-25T10:00:00Z');

describe('ocr-failed-read: the stamp (#7378)', () => {
  it("has realtime-ocr's keys (reason, finish_reason, at, model), plus engine and detail", () => {
    const s = failedReadStamp({ reason: 'timeout', model: 'PaddleOCR-VL-1.6-0.9B', engine: 'x.mjs', finishReason: 'SIGTERM', detail: 'a\n  b', at: AT });
    expect(s).toEqual({ reason: 'timeout', finish_reason: 'SIGTERM', at: AT, model: 'PaddleOCR-VL-1.6-0.9B', engine: 'x.mjs', detail: 'a b' });
  });
  it('the realtime-ocr stamp keys are a subset of it (same field, same reader)', () => {
    const src = readFileSync(path.resolve(__dirname, '../../scripts/batch/realtime-ocr.mjs'), 'utf8');
    const m = src.match(/'ocr\.last_skip': \{ ([^}]*) \}/);
    expect(m).toBeTruthy();
    const keys = m![1].split(',').map((k) => k.split(':')[0].trim());
    const stamp = failedReadStamp({ reason: 'empty', model: 'm' });
    for (const k of keys) expect(Object.keys(stamp)).toContain(k);
  });
  it('refuses an unknown reason or a missing model: the census would be told nothing true', () => {
    expect(() => failedReadStamp({ reason: 'recitation', model: 'm' })).toThrow(/reason/);
    expect(() => failedReadStamp({ reason: 'loop', model: 'm' })).toThrow(/reason/);
    expect(() => failedReadStamp({ reason: 'empty' })).toThrow(/model/);
    expect(FAILED_READ_REASONS).toEqual(['refused', 'empty', 'timeout', 'error']);
  });
  it('clips detail to 200 characters and keeps a bad date from becoming NaN', () => {
    const s = failedReadStamp({ reason: 'error', model: 'm', detail: 'x'.repeat(500), at: 'not a date' });
    expect(s.detail).toHaveLength(200);
    expect(Number.isNaN(+s.at)).toBe(false);
  });
});

describe('ocr-failed-read: the write keeps the human-edit guard and touches no routing field', () => {
  it('the filter refuses a human-edited page, a bare-string ocr, and an equal or newer stamp', () => {
    expect(failedReadFilter('p1', AT)).toEqual({
      id: 'p1', 'ocr.source': { $ne: 'manual' }, 'ocr.edited_by': { $in: [null, ''] },
      ocr: { $not: { $type: 'string' } }, 'ocr.last_skip.at': { $not: { $gte: AT } },
    });
  });
  it('the update sets ocr.last_skip and nothing else (no data, model, fail_* or recitation_* field)', () => {
    const u = failedReadUpdate(failedReadStamp({ reason: 'error', model: 'm', at: AT }));
    expect(u).toHaveLength(2);
    expect(Object.keys(u[1].$set)).toEqual(['ocr.last_skip']);
    expect(JSON.stringify(u)).not.toMatch(/fail_count|fail_blocked|recitation|ocr\.data|ocr\.model|ocr\.source/);
  });
  it('recordFailedReads sends one guarded updateOne per row, and never throws on a database error', async () => {
    const calls: unknown[] = [];
    const db = { collection: () => ({ bulkWrite: async (ops: unknown[]) => { calls.push(...ops); return { modifiedCount: ops.length, matchedCount: ops.length }; } }) };
    const r = await recordFailedReads(db, [{ pageId: 'a', reason: 'empty', model: 'm', at: AT }, null, { pageId: 'b', reason: 'error', model: 'm', at: AT }]);
    expect(r).toEqual({ stamped: 2, matched: 2, rows: 2 });
    expect((calls[0] as { updateOne: { filter: { id: string } } }).updateOne.filter.id).toBe('a');
    const bad = { collection: () => ({ bulkWrite: async () => { throw new Error('down'); } }) };
    const r2 = await recordFailedReads(bad, [{ pageId: 'a', reason: 'empty', model: 'm' }], { log: () => {} });
    expect(r2).toMatchObject({ stamped: 0, rows: 1, error: 'down' });
  });
  it('errorReason tells a timeout from an error', () => {
    expect(errorReason('ReadTimeout: HTTPConnectionPool timed out')).toBe('timeout');
    expect(errorReason(new Error('AbortError: The operation was aborted'))).toBe('timeout');
    expect(errorReason('runner exit 3: wedged page')).toBe('timeout');
    expect(errorReason('CUDA error: out of memory')).toBe('error');
  });
});

describe('Paddle zh fleet and Paddle print: a box .err file and a textless read', () => {
  it('an .err file is a failed read of PADDLE.model, timed by the file', () => {
    expect(fromErrFile({ pageId: 'p', text: 'fetch failure / timeout after 600 s', mtime: AT, model: PADDLE.model, engine: 'scripts/workers/paddle-zh-lane.mjs' }))
      .toEqual({ pageId: 'p', reason: 'timeout', model: 'PaddleOCR-VL-1.6-0.9B', engine: 'scripts/workers/paddle-zh-lane.mjs', detail: 'fetch failure / timeout after 600 s', at: AT });
    expect(fromErrFile({ pageId: 'p', text: '', mtime: AT, model: PADDLE.model, engine: 'e' })).toMatchObject({ reason: 'error', detail: 'error file' });
  });
  it('a textless read is an empty stamp (the census keeps it out of k unless another read shows text)', () => {
    expect(fromTextless({ pageId: 'p', model: PADDLE.model, engine: 'e', chars: 3, at: AT })).toMatchObject({ reason: 'empty', detail: 'textless read (3 characters)' });
  });
});

describe('cli-ocr apply: the agy lanes and the Claude reads (claude-ocr.mjs writes through it)', () => {
  const meta = { page_id: 'p', model: 'gemini-3.8-flash-low', finished_at: '2026-10-25T09:00:00Z', exit: 0, error_class: null };
  it('a CLI timeout, a crash and an empty turn', () => {
    expect(fromCliRead({ ...meta, exit: -9, error_class: 'timeout' }, 'exit')).toMatchObject({ reason: 'timeout', finishReason: 'timeout', model: 'gemini-3.8-flash-low' });
    expect(fromCliRead({ ...meta, exit: 1, error_class: 'exit_1', stderr_tail: 'boom' }, 'exit')).toMatchObject({ reason: 'error', detail: 'exit 1 exit_1: boom' });
    expect(fromCliRead({ ...meta, exit: 2, error_class: 'denied_tool' }, 'exit')).toMatchObject({ reason: 'empty' });
    expect(fromCliRead(meta, 'empty')).toMatchObject({ reason: 'empty', at: '2026-10-25T09:00:00Z' });
  });
  it('a refusal, a restarted read and a cut wrapper are refusals', () => {
    expect(fromCliRead(meta, 'refused')).toMatchObject({ reason: 'refused' });
    expect(fromCliRead({ ...meta, wrapper: 'cut before <<<END>>>' }, 'wrapper')).toMatchObject({ reason: 'refused', detail: 'reply wrapper: cut before <<<END>>>' });
  });
  it("a Claude read stamps the model its meta names, and an image that could not be fetched is not the engine's failure", () => {
    expect(fromCliRead({ ...meta, model: 'claude-opus-5-5', exit: 1, error_class: 'exit_1_error_max_turns' }, 'exit')).toMatchObject({ model: 'claude-opus-5-5', reason: 'error' });
    expect(fromCliRead({ ...meta, model: 'opus', exit: 1, error_class: 'image HTTP 404' }, 'exit')).toBeNull();
  });
  it("our own guards' skips (loop, write guard, shared-words floor) are not stamped", () => {
    expect(fromCliRead(meta, 'loop')).toBeNull();
    expect(fromCliRead(meta, undefined)).toBeNull();
    expect(fromCliRead({ ...meta, page_id: undefined }, 'empty')).toBeNull();
  });
});

describe('Syriac Kraken: fail.jsonl and a textless read', () => {
  it('a kraken-stage failure is stamped (timeout by signal), a fetch failure is not', () => {
    const at = '2026-10-25T08:00:00.000Z';
    expect(fromKrakenFail({ bid: 'b', pn: 3, stage: 'kraken', rc: null, signal: 'SIGTERM', err: '', at }, { pageId: 'p', model: 'kraken/omnisyr' }))
      .toMatchObject({ pageId: 'p', reason: 'timeout', model: 'kraken/omnisyr', finishReason: 'SIGTERM', at });
    expect(fromKrakenFail({ stage: 'kraken', rc: 1, signal: null, err: 'Traceback … ValueError', at }, { pageId: 'p', model: 'kraken/sophro-mhiro' }))
      .toMatchObject({ reason: 'error', finishReason: 'rc 1', detail: 'Traceback … ValueError' });
    expect(fromKrakenFail({ stage: 'fetch', reason: 'HTTP 404' }, { pageId: 'p', model: 'kraken/omnisyr' })).toBeNull();
    expect(fromKrakenFail({ stage: 'kraken', rc: 1 }, { pageId: null, model: 'kraken/omnisyr' })).toBeNull();
  });
});

describe('NDL koten and the Yigdzin apply: a textless read', () => {
  it('stamps the model id the lane writes to ocr.model', () => {
    expect(fromTextless({ pageId: 'p', model: 'ndl-koten/v3', engine: 'scripts/workers/ndl-koten-lane.mjs', chars: 0, at: AT })).toMatchObject({ reason: 'empty', model: 'ndl-koten/v3' });
    expect(fromTextless({ pageId: 'p', model: 'bdrc-yigdzin-v1', engine: 'scripts/maintenance/apply-reocr-verdicts.mjs', chars: 12, at: AT })).toMatchObject({ reason: 'empty', model: 'bdrc-yigdzin-v1' });
  });
});

describe('guarded Paddle (#6871): UNREAD and a Flash page held after both rounds', () => {
  it('an UNREAD Paddle error is Paddle\'s failed read; an UNREAD fetch error is not', () => {
    expect(fromGuardedRead({ rec: { page_id: 'p', route: 'UNREAD', error: 'paddle: no output', at: '2026-10-18T18:00:00Z' }, paddleModel: PADDLE.model }))
      .toMatchObject({ pageId: 'p', reason: 'error', model: PADDLE.model, at: '2026-10-18T18:00:00Z' });
    expect(fromGuardedRead({ rec: { page_id: 'p', route: 'UNREAD', error: 'HTTP 503' }, paddleModel: PADDLE.model })).toBeNull();
  });
  it('a Flash HOLD is a failed read of the Flash model; PENDING (a quota stop) is not', () => {
    const rec = { page_id: 'p', route: 'FLASH' };
    expect(fromGuardedRead({ rec, flash: { route: 'HOLD', model: 'gemini-3.8-flash-low', attempt: 2, reply_flags: ['EMPTY'], date: null }, paddleModel: PADDLE.model, flashAt: AT }))
      .toMatchObject({ reason: 'empty', model: 'gemini-3.8-flash-low', at: AT });
    expect(fromGuardedRead({ rec, flash: { route: 'PENDING', model: 'gemini-3.8-flash-low' }, paddleModel: PADDLE.model })).toBeNull();
  });
  it('reasonFromFlags', () => {
    expect(reasonFromFlags(['REFUSAL'])).toBe('refused');
    expect(reasonFromFlags(['CLI timeout'])).toBe('timeout');
    expect(reasonFromFlags(['fetch: HTTP 404'])).toBeNull();
    expect(reasonFromFlags(['CHATTER'])).toBe('error');
  });
});

// Each writer that reads OCR outside the Gemini API must call the helper, under its write mode. A writer that loses
// the call goes back to reading 0 of n in the census, silently: that is the failure this test exists to catch.
const WRITERS = [
  'scripts/workers/paddle-zh-lane.mjs',
  'scripts/workers/paddle-print-lane.mjs',
  'scripts/workers/paddle-zh-guarded-lane.mjs',
  'scripts/workers/syriac-kraken-lane.mjs',
  'scripts/workers/ndl-koten-lane.mjs',
  'scripts/batch/cli-ocr.mjs',
  'scripts/maintenance/apply-reocr-verdicts.mjs',
];
describe('every non-Gemini-API OCR writer stamps a failed read', () => {
  for (const f of WRITERS) {
    it(f, () => {
      const src = readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
      expect(src).toMatch(/from '\.\.\/lib\/ocr-failed-read\.mjs'/);
      expect(src).toMatch(/recordFailedReads\(db,/);
      // every call sits behind the write mode: a dry run stamps nothing
      for (const m of src.matchAll(/recordFailedReads\(db,/g)) {
        const before = src.slice(Math.max(0, m.index! - 600), m.index);
        expect(before, `${f}: a recordFailedReads call not behind APPLY`).toMatch(/APPLY/);
      }
    });
  }
});
