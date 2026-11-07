/**
 * Lane stamps (#7301 item 3) and the per-job book list (item 5).
 *
 * 1. laneForWrite maps each registered writer (call_site + engine family) to exactly one lane, and nothing else.
 * 2. The provenance helpers stamp `lane` beside `engine` for a registered writer and write no `lane` key otherwise,
 *    so every Batch / API writer is unchanged. No src/ writer is a stamped lane (the TS twin returns no lane).
 * 3. Each stamp's call_site is a file that stamps: it goes through ocrProvenance / translationProvenance /
 *    writePageTranslation, or calls laneForWrite itself. The specialist `$set` builders carry `ocr.lane`.
 * 4. The book list update is pure and idempotent on a re-run.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — scripts-side module, no types
import { LANES, laneForWrite } from '../../scripts/lib/lanes.mjs';
import * as mjs from '../../scripts/lib/write-provenance.mjs';
// @ts-expect-error — scripts-side module, no types
import { laneBooksUpdate, laneJob } from '../../scripts/lib/lane-book-list.mjs';

type Stamp = { field: string; call_site: string; engine?: string };
type Lane = { name: string; stamps?: Stamp[] };
const ROOT = path.resolve(__dirname, '../..');

const cliEngine = (call_site: string, cli: 'agy' | 'claude', input: ReturnType<typeof mjs.imageInput> | ReturnType<typeof mjs.translationInput>) => mjs.geminiEngine({
  name: mjs.engineNameForCli(cli), call_site, api: 'cli', cli: { name: cli, version: '1.0' }, model: cli === 'claude' ? 'opus' : 'gemini-3.8-flash-low',
  prompt: { id: 'p', name: 'p', version: 1, text: 'Transcribe.' },
  generationConfig: mjs.notRecorded('cli'),
  run: { code_version: 'abc', host: 'h', job_id: 'j' },
  input,
});
const img = mjs.imageInput({ url: 'https://images.sourcelibrary.org/archived/b1/3.jpg', mime: 'image/jpeg', bytes: 1 });
const txt = mjs.translationInput({ ocrText: 'Lorem', ocrUpdatedAt: new Date('2026-10-01') });

describe('laneForWrite', () => {
  it('splits the two CLI writers by engine family', () => {
    expect(laneForWrite('ocr', { call_site: 'scripts/batch/cli-ocr.mjs', name: 'gemini' })).toBe('agy-flash-ocr');
    expect(laneForWrite('ocr', { call_site: 'scripts/batch/cli-ocr.mjs', name: 'anthropic' })).toBe('claude-opus-ocr');
    expect(laneForWrite('translation', { call_site: 'scripts/batch/cli-translate.mjs', name: 'gemini' })).toBe('agy-flash-translate');
    expect(laneForWrite('translation', { call_site: 'scripts/batch/cli-translate.mjs', name: 'anthropic' })).toBe('claude-opus-translate');
    expect(laneForWrite('ocr', { call_site: 'scripts/workers/paddle-zh-guarded-lane.mjs', name: 'gemini' })).toBe('paddle-zh-guarded');
    expect(laneForWrite('ocr', { call_site: 'scripts/lib/paddle-zh-lane.mjs' })).toBe('paddle-zh');
  });

  it('a writer the registry does not stamp gets no lane, and the field must match', () => {
    expect(laneForWrite('ocr', { call_site: 'scripts/batch/realtime-ocr.mjs', name: 'gemini' })).toBeNull();
    expect(laneForWrite('translation', { call_site: 'scripts/batch/cli-ocr.mjs', name: 'gemini' })).toBeNull();
    expect(laneForWrite('ocr', null)).toBeNull();
  });

  it('no two lanes claim the same write, and no lane stamps a src/ writer', () => {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const l of LANES as Lane[]) {
      for (const s of l.stamps ?? []) {
        const k = `${s.field}|${s.call_site}|${s.engine ?? '*'}`;
        if (seen.has(k)) problems.push(`${k}: ${seen.get(k)} and ${l.name}`);
        seen.set(k, l.name);
        if (s.call_site.startsWith('src/')) problems.push(`${l.name}: stamps src/ writer ${s.call_site} (the TS twin returns no lane)`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('each stamp call_site exists and stamps through a helper that reads the registry', () => {
    const STAMPS = /ocrProvenance\(|translationProvenance\(|writePageTranslation\(|laneForWrite\(/;
    const problems = (LANES as Lane[]).flatMap((l) => (l.stamps ?? []).filter((s) => {
      const f = path.join(ROOT, s.call_site);
      return !fs.existsSync(f) || !STAMPS.test(fs.readFileSync(f, 'utf8'));
    }).map((s) => `${l.name}: ${s.call_site}`));
    expect(problems).toEqual([]);
  });
});

describe('the provenance helpers stamp the lane', () => {
  it('cli-ocr and cli-translate writes carry the lane beside engine', () => {
    expect(mjs.ocrProvenance('text', cliEngine('scripts/batch/cli-ocr.mjs', 'agy', img)).lane).toBe('agy-flash-ocr');
    expect(mjs.ocrProvenance('text', cliEngine('scripts/batch/cli-ocr.mjs', 'claude', img)).lane).toBe('claude-opus-ocr');
    expect(mjs.translationProvenance('english', cliEngine('scripts/batch/cli-translate.mjs', 'claude', txt)).lane).toBe('claude-opus-translate');
  });

  it('an unregistered writer gets no lane key at all', () => {
    const f = mjs.ocrProvenance('text', cliEngine('scripts/batch/some-other.mjs', 'agy', img));
    expect(Object.keys(f).sort()).toEqual(['content_hash', 'engine']);
  });

  it('the specialist $set builders carry ocr.lane', async () => {
    // @ts-expect-error — scripts-side module, no types
    const kraken = await import('../../scripts/lib/syriac-kraken-lane.mjs');
    // @ts-expect-error — scripts-side module, no types
    const ndl = await import('../../scripts/lib/ndl-koten-lane.mjs');
    // @ts-expect-error — scripts-side module, no types
    const paddle = await import('../../scripts/lib/paddle-zh-lane.mjs');
    // @ts-expect-error — scripts-side module, no types
    const print = await import('../../scripts/lib/paddle-print-lane.mjs');
    expect(kraken.ocrSetFields('ܫܠܡܐ', Object.keys(kraken.ENGINES)[0], 'manuscript', {})['ocr.lane']).toBe('kraken-syriac');
    expect(ndl.ocrSetFields('いろは', 'koten', {})['ocr.lane']).toBe('ndl-koten');
    expect(paddle.ocrSetFields('天地', {})['ocr.lane']).toBe('paddle-zh');
    expect(print.ocrField('天地', { language: 'Chinese' }).lane).toBe('paddle-print');
  });
});

describe('the per-job book list', () => {
  it('one document per (lane, job): books de-duplicated, the largest page list, never a running sum', () => {
    const now = new Date('2026-10-26T00:00:00Z');
    const u = laneBooksUpdate({ lane: 'agy-flash-ocr', job: 'j1', lands: 7301, pages: [{ book_id: 'b' }, { book_id: 'a' }, { book_id: 'b' }], now, box: 'l7a' });
    expect(u.filter).toEqual({ _id: 'agy-flash-ocr|j1' });
    expect(u.bookIds).toEqual(['a', 'b']);
    expect(u.update.$addToSet).toEqual({ book_ids: { $each: ['a', 'b'] } });
    expect(u.update.$max).toEqual({ pages: 3 });
    expect(u.update.$set).toEqual({ lands: 7301, last_at: now, box: 'l7a' });
    expect(u.update.$setOnInsert).toMatchObject({ lane: 'agy-flash-ocr', job: 'j1', until: 'R6 #5825' });
  });

  it('the job and its Lands issue come from claude-job.sh, else the reader\'s --job', () => {
    expect(laneJob('cli-ocr', { JOB_NAME: 'flash-greek-7075', JOB_LANDS: '7075' })).toEqual({ job: 'flash-greek-7075', lands: 7075 });
    expect(laneJob('cli-ocr', { JOB_LANDS: 'none' })).toEqual({ job: 'cli-ocr', lands: null });
    expect(laneJob(undefined, {})).toEqual({ job: 'manual', lands: null });
  });
});
