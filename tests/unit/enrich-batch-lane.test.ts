import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs worker lib, no types
import { gapFilter, REALTIME_LANE_STATUSES, enrichPauseMode } from '../../scripts/workers/lib/enrich-batch-lane.mjs';

/**
 * The Batch API enrich lane (#2141) selects books by MISSING OUTPUT. Its exclusions are what keep
 * it off books whose derived lane must wait (held #4790, bad reads) and off books the realtime
 * status-driven lane owns (so the two never pay twice for one book).
 */
describe('enrich batch lane gap filter', () => {
  const f = gapFilter();

  it('selects only live translated books', () => {
    expect(f.visible).toBe(true);
    expect(f.pages_count).toEqual({ $gt: 0 });
    expect(f.pages_translated).toEqual({ $gt: 0 });
  });

  it('refuses held books by marker and by status', () => {
    expect(f['pipeline_auto.hold']).toEqual({ $exists: false });
    expect(f['pipeline_auto.status'].$nin).toContain('held');
  });

  it('leaves the realtime lane its own statuses', () => {
    for (const s of ['translate_complete', 'summarizing', 'summary_indexed', 'chapters']) {
      expect(REALTIME_LANE_STATUSES).toContain(s);
    }
    expect(f['pipeline_auto.status'].$nin).toEqual(REALTIME_LANE_STATUSES);
  });

  it('excludes bad-read flags', () => {
    for (const k of ['needs_resplit', 'source_unrecoverable', 'spread_translation_crisis', 'translation_stale_reason']) {
      expect(f[k]).toBeDefined();
    }
  });

  it('a scope confines, it never widens', () => {
    const scoped = gapFilter({ id: { $in: ['a', 'b'] } });
    expect(scoped.id).toEqual({ $in: ['a', 'b'] });
    expect(scoped.visible).toBe(true);
  });
});

// #5496 review B2: enrich_batch_jobs in `submitted` are already paid. A pause must stop the
// lane from SUBMITTING, never from COLLECTING, or Gemini expires the jobs at 48 h.
describe('enrichPauseMode — a pause never strands a paid batch', () => {
  const ctl = (c: object) => ({ _id: 'processing_control', ...c });
  const paused: Array<[string, object]> = [
    ['enrich key', { paused_phases: ['enrich'] }],
    ['legacy name', { paused_phases: ['enrichment'] }],
    ['legacy number 6', { paused_phases: [6] }],
    ['global pause, no scope', { paused: true }],
  ];
  for (const [label, c] of paused) {
    it(`${label}: --batch runs collect-only, realtime skips`, () => {
      expect(enrichPauseMode(ctl(c), { batchMode: true })).toMatchObject({ mode: 'collect-only' });
      expect(enrichPauseMode(ctl(c), { batchMode: false })).toMatchObject({ mode: 'skip' });
    });
  }
  it('no pause, or an unrelated key: full run', () => {
    for (const c of [{}, { paused_phases: ['ocr', 'images'] }]) {
      expect(enrichPauseMode(ctl(c), { batchMode: true })).toEqual({ mode: 'run', reason: null });
      expect(enrichPauseMode(ctl(c), { batchMode: false })).toEqual({ mode: 'run', reason: null });
    }
  });
  it('a global pause with a scope runs (the scope confines books later); a step pause beats a scope', () => {
    expect(enrichPauseMode(ctl({ paused: true, allow_book_ids: ['b1'] }), { batchMode: false }).mode).toBe('run');
    expect(enrichPauseMode(ctl({ paused_phases: ['enrich'], allow_book_ids: ['b1'] }), { batchMode: true }).mode).toBe('collect-only');
  });
});
