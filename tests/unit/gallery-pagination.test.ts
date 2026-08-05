import { describe, it, expect } from 'vitest';
import { canLoadMore } from '@/lib/gallery-pagination';

describe('canLoadMore', () => {
  it('offers more when the server says there is more', () => {
    expect(canLoadMore({ hasMore: true, total: 14681 }, 48, 48)).toBe(true);
  });

  it('stops when the server says there is no more', () => {
    expect(canLoadMore({ hasMore: false, total: 36 }, 36, 48)).toBe(false);
  });

  // #3605: /gallery?type=artwork returns total=0, but the component could still
  // be holding a hasMore:true response from the previous, unfiltered query.
  // With zero items rendered, "Load more" must not appear next to the
  // "No images found" message — clicking it can only ever be a no-op.
  it('never offers more when nothing is rendered, even on a stale hasMore', () => {
    expect(canLoadMore({ hasMore: true, total: 14681 }, 0, 48)).toBe(false);
  });

  it('never offers more for a genuinely empty filter result', () => {
    expect(canLoadMore({ hasMore: false, total: 0 }, 0, 0)).toBe(false);
  });

  it('falls back to offset-vs-total when the server omits hasMore', () => {
    expect(canLoadMore({ total: 100 }, 48, 48)).toBe(true);
    expect(canLoadMore({ total: 48 }, 48, 48)).toBe(false);
  });

  it('treats a missing total as exhausted rather than infinite', () => {
    expect(canLoadMore({}, 48, 48)).toBe(false);
  });

  it('offers nothing before the first response', () => {
    expect(canLoadMore(null, 0, 0)).toBe(false);
  });
});
