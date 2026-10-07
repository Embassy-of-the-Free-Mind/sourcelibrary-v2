import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs worker lib, no types
import { gapFilter, REALTIME_LANE_STATUSES } from '../../scripts/workers/lib/enrich-batch-lane.mjs';

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
