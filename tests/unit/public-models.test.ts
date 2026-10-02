/**
 * /about/models must not drift from the engines that actually write pages (#5601).
 *
 * src/data/model-usage-recent.json is written by scripts/audit/model-usage-snapshot.mjs
 * --write-recent: every (lane, model, source) that wrote pages in the 30 days before its date,
 * read from the pages' own provenance. Each must land on an entry of the public page. The
 * routing defaults are checked too, so a new default model fails here before it writes a page.
 */
import { describe, it, expect } from 'vitest';
import { MODELS, JOBS, engineFor } from '@/data/public-models';
import { DEFAULT_MODEL, DEFAULT_LITE_MODEL } from '@/lib/types/ai-models';
import recent from '@/data/model-usage-recent.json';

describe('public models page', () => {
  it('describes every engine that wrote pages in the last 30 days of the snapshot', () => {
    expect(recent.rows.length).toBeGreaterThan(0);
    const unlisted = recent.rows.filter(r => !engineFor(r.lane, r.model, r.source));
    expect(unlisted, `add an entry to src/data/public-models.ts for: ${JSON.stringify(unlisted)}`).toEqual([]);
  });

  it('describes the routing defaults for reading and translating', () => {
    for (const lane of ['ocr', 'translation']) {
      for (const model of [DEFAULT_MODEL, DEFAULT_LITE_MODEL]) {
        expect(engineFor(lane, model, 'batch_api'), `${lane} ${model}`).not.toBeNull();
      }
    }
  });

  it('flags an engine it has never seen (negative control)', () => {
    expect(engineFor('ocr', 'some-new-ocr/1', 'some-new-lane')).toBeNull();
    expect(engineFor('translation', 'some-new-model', 'ai')).toBeNull();
  });

  it('a specialist model wins over a Gemini-shaped source', () => {
    expect(engineFor('ocr', 'bdrc-woodblock-easter2', 'ai')).toBe('ocr-bdrc');
  });

  it('every entry is complete, and every job has one', () => {
    const ids = new Set<string>();
    for (const m of MODELS) {
      expect(ids.has(m.id), `duplicate id ${m.id}`).toBe(false);
      ids.add(m.id);
      for (const f of ['name', 'books', 'weakness'] as const) expect(m[f].trim(), `${m.id}.${f}`).not.toBe('');
      for (const e of m.evidence) expect(e.href, `${m.id} evidence`).toMatch(/^(https:\/\/|\/)/);
    }
    for (const j of JOBS) expect(MODELS.some(m => m.job === j.job), j.job).toBe(true);
  });

  it('the Siku Quanshu lane is on the page', () => {
    expect(engineFor('ocr', 'PaddleOCR-VL-1.6', 'paddle')).toBe('ocr-paddle');
  });
});
