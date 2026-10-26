import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getTestDb, cleanDb } from '../setup';
// @ts-expect-error — plain .mjs module
import { recordFailedReads } from '../../scripts/lib/ocr-failed-read.mjs';

/**
 * #7378 against a real Mongo: the failed-read stamp's guards hold in the update filter, and the route census counts
 * the stamp under the route that made it.
 */

const T0 = new Date('2026-10-25T10:00:00Z');
const T1 = new Date('2026-10-25T11:00:00Z');
const row = (pageId: string, extra: Record<string, unknown> = {}) => ({ pageId, reason: 'error', model: 'PaddleOCR-VL-1.6-0.9B', engine: 'test', detail: 'boom', at: T0, ...extra });

let OCR_STATUS: unknown;
const OUT = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'route-census-test-'));
beforeAll(async () => {
  // route-census.mjs reads --out at import and exits without it
  process.argv.push(`--out=${OUT}`);
  ({ OCR_STATUS } = await import('../../scripts/eval/estimator/ocr/route-census.mjs'));
});
beforeEach(cleanDb);

describe('recordFailedReads on a real collection', () => {
  it('stamps a page with no ocr, ocr: null, and an ocr object (its text untouched)', async () => {
    const P = getTestDb().collection('pages');
    await P.insertMany([{ id: 'a' }, { id: 'b', ocr: null }, { id: 'c', ocr: { data: 'old text', model: 'gemini-3.1-flash-lite' } }]);
    const r = await recordFailedReads(getTestDb(), ['a', 'b', 'c'].map((id) => row(id)));
    expect(r).toMatchObject({ stamped: 3, rows: 3 });
    const c = await P.findOne({ id: 'c' });
    expect(c!.ocr).toMatchObject({ data: 'old text', model: 'gemini-3.1-flash-lite', last_skip: { reason: 'error', model: 'PaddleOCR-VL-1.6-0.9B', engine: 'test', detail: 'boom', finish_reason: null } });
    expect((await P.findOne({ id: 'a' }))!.ocr.last_skip.at).toEqual(T0);
    expect((await P.findOne({ id: 'b' }))!.ocr.last_skip.reason).toBe('error');
  });

  it('never writes a human-edited page or a bare-string ocr', async () => {
    const P = getTestDb().collection('pages');
    await P.insertMany([
      { id: 'manual', ocr: { data: 'typed by a person', source: 'manual' } },
      { id: 'edited', ocr: { data: 'corrected', edited_by: 'derek' } },
      { id: 'legacy', ocr: 'a bare string read' },
    ]);
    const r = await recordFailedReads(getTestDb(), ['manual', 'edited', 'legacy'].map((id) => row(id)));
    expect(r.stamped).toBe(0);
    expect((await P.findOne({ id: 'manual' }))!.ocr).toEqual({ data: 'typed by a person', source: 'manual' });
    expect((await P.findOne({ id: 'edited' }))!.ocr).toEqual({ data: 'corrected', edited_by: 'derek' });
    expect((await P.findOne({ id: 'legacy' }))!.ocr).toBe('a bare string read');
  });

  it('a rerun is a no-op, and an older failure never hides a newer one', async () => {
    const P = getTestDb().collection('pages');
    await P.insertOne({ id: 'p' });
    expect((await recordFailedReads(getTestDb(), [row('p', { at: T1, reason: 'timeout' })])).stamped).toBe(1);
    expect((await recordFailedReads(getTestDb(), [row('p', { at: T1, reason: 'timeout' })])).stamped).toBe(0);
    expect((await recordFailedReads(getTestDb(), [row('p', { at: T0, reason: 'empty' })])).stamped).toBe(0);
    expect((await P.findOne({ id: 'p' }))!.ocr.last_skip).toMatchObject({ reason: 'timeout', at: T1 });
  });

  it('a $ in the detail is stored as text, not read as an operator', async () => {
    const P = getTestDb().collection('pages');
    await P.insertOne({ id: 'p' });
    await recordFailedReads(getTestDb(), [row('p', { detail: '$ocr.data missing' })]);
    expect((await P.findOne({ id: 'p' }))!.ocr.last_skip.detail).toBe('$ocr.data missing');
  });
});

describe('route census: the stamp is counted', () => {
  const status = async () => Object.fromEntries((await getTestDb().collection('pages').aggregate([
    { $project: { _id: 0, id: 1, st: OCR_STATUS, rm: { $ifNull: ['$ocr.last_skip.model', '$ocr.fail_blocked_model'] } } }]).toArray()).map((r) => [r.id, [r.st, r.rm]]));

  it('error / timeout → failed, refused → refused, empty with no text → empty, any of them over a standing read → read_after_*', async () => {
    const P = getTestDb().collection('pages');
    await P.insertMany([{ id: 'err' }, { id: 'tmo' }, { id: 'ref' }, { id: 'emp' }, { id: 'emp-read', ocr: { data: 'text another engine read', model: 'gemini-3.1-flash-lite' } },
      { id: 'err-read', ocr: { data: 'lite text', model: 'gemini-3.1-flash-lite' } }, { id: 'legacy-noimg' }]);
    await recordFailedReads(getTestDb(), [row('err'), row('tmo', { reason: 'timeout' }), row('ref', { reason: 'refused', model: 'claude-opus-5-5' }),
      row('emp', { reason: 'empty', model: 'ndl-koten/v3' }), row('emp-read', { reason: 'empty' }), row('err-read')]);
    // realtime-ocr's own no-image stamp is not a read
    await P.updateOne({ id: 'legacy-noimg' }, { $set: { 'ocr.last_skip': { reason: 'no-image', at: T0, model: 'gemini-3.1-flash-lite' } } });
    expect(await status()).toEqual({
      err: ['failed', 'PaddleOCR-VL-1.6-0.9B'], tmo: ['failed', 'PaddleOCR-VL-1.6-0.9B'], ref: ['refused', 'claude-opus-5-5'],
      emp: ['empty', 'ndl-koten/v3'], 'emp-read': ['read_after_failure', 'PaddleOCR-VL-1.6-0.9B'], 'err-read': ['read_after_failure', 'PaddleOCR-VL-1.6-0.9B'],
      'legacy-noimg': ['empty', 'gemini-3.1-flash-lite'],
    });
  });

  it('emit charges a failure to the route that stamped it, and the standing read to its own engine', async () => {
    const { emit } = await import('../../scripts/eval/estimator/ocr/route-census-emit.mjs');
    const dir = fs.mkdtempSync(path.join(OUT, 'emit-'));
    const P = 'PaddleOCR-VL-1.6-0.9B', L = 'gemini-3.1-flash-lite';
    fs.writeFileSync(path.join(dir, 'books.jsonl'), JSON.stringify({ id: 'b1', language: 'Chinese', script: 'han', era: 'early', book_class: 'printed',
      ocr: [[L, 'ai', null, null, 'read_after_failure', P, 30], [P, 'paddle', null, null, 'read', null, 60], [null, null, null, null, 'failed', P, 10],
        [null, null, null, null, 'empty', 'ndl-koten/v3', 5], ['ndl-koten/v3', 'ndl-koten', null, null, 'read', null, 20]], tr: [] }) + '\n');
    await emit({ OUT: dir, NOW: new Date(), DAYS: 60, helpers: { era: () => 'early', chartOf: () => 'chinese-print', familyOf: (m: string) => m,
      routeName: (m: string | null) => m ?? null, READ_SOURCES: new Set(['paddle', 'ai', 'ndl-koten']), NOT_MODEL: /^manual$/, GEMINI: /gemini/i } });
    const rows = fs.readFileSync(path.join(dir, 'out', 'failures.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((r) => r.rate === 'failed_read');
    const paddle = rows.find((r) => r.raw_route === P);
    expect(paddle).toMatchObject({ k: 40, n: 100, k_failed: 40 });
    // lite's 30 reads stand and lite stamped nothing: it is still an unstamped route, so it gets no failed_read row
    expect(rows.find((r) => r.raw_route === L)).toBeUndefined();
    const summary = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'summary.json'), 'utf8'));
    expect(summary.part1.unstamped_routes[`ocr|${L}`]).toBe(30);
    // NDL's empty stamp lands on NDL (k_empty, not k), so NDL is still unstamped by failures
    expect(summary.part1.unstamped_routes['ocr|ndl-koten/v3']).toBe(25);
  });
});
