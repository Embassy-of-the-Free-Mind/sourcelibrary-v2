/**
 * `streamOrdered` exists because fetch-all-then-write breaks at real book sizes
 * (#3597: 231s of silence on a "streamed" 366-page facsimile PDF, 707MB peak
 * RSS, with 6,987 visible books larger than that one).
 *
 * The three properties that make it a fix rather than a reshuffle:
 *   1. results arrive in INPUT order (the consumer writes pages sequentially),
 *   2. at most `lookahead` results are held (memory flat in input length),
 *   3. the first result is available before the last fetch finishes (bytes flow
 *      immediately, so the connection is never silent).
 * Each is tested by exercising the generator, not by inspecting its source.
 */
import { describe, it, expect } from 'vitest';
import { streamOrdered } from '@/lib/ordered-stream';

/** Resolves after `ms`, recording concurrency high-water and start order. */
function makeFetcher(delays: number[]) {
  const state = { active: 0, peakActive: 0, started: [] as number[], settled: 0 };
  const fetch = async (item: number, index: number) => {
    state.active++;
    state.peakActive = Math.max(state.peakActive, state.active);
    state.started.push(index);
    await new Promise(r => setTimeout(r, delays[index] ?? 1));
    state.active--;
    state.settled++;
    return `v${item}`;
  };
  return { fetch, state };
}

describe('streamOrdered', () => {
  it('yields in input order even when later items resolve first', async () => {
    const items = [0, 1, 2, 3, 4];
    // Item 0 is the slowest; without ordering it would arrive last.
    const { fetch } = makeFetcher([40, 1, 1, 1, 1]);
    const seen: string[] = [];
    for await (const { value } of streamOrdered(items, fetch, { concurrency: 5 })) {
      seen.push(value);
    }
    expect(seen).toEqual(['v0', 'v1', 'v2', 'v3', 'v4']);
  });

  it('respects the concurrency cap', async () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const { fetch, state } = makeFetcher(items.map(() => 5));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamOrdered(items, fetch, { concurrency: 4, lookahead: 4 })) {
      // drain
    }
    expect(state.peakActive).toBeLessThanOrEqual(4);
  });

  it('keeps at most `lookahead` fetches ahead of the consumer', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const { fetch, state } = makeFetcher(items.map(() => 1));
    let consumed = 0;
    for await (const { index } of streamOrdered(items, fetch, { concurrency: 4, lookahead: 6 })) {
      consumed = index + 1;
      // Nothing beyond the window may have been STARTED yet. This is the
      // property that bounds memory: without it every item is fetched up front.
      const maxStarted = Math.max(...state.started);
      expect(maxStarted).toBeLessThan(consumed + 6);
    }
    expect(consumed).toBe(50);
  });

  it('emits the first result before the last fetch has settled', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    // Item 0 is fast, the tail is slow — first byte must not wait for the tail.
    const delays = items.map((_, i) => (i === 0 ? 1 : 60));
    const { fetch, state } = makeFetcher(delays);
    const iter = streamOrdered(items, fetch, { concurrency: 4, lookahead: 4 })[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.value?.value).toBe('v0');
    expect(state.settled).toBeLessThan(items.length);
    await iter.return?.(undefined as never);
  });

  it('propagates a rejection rather than hanging', async () => {
    const boom = async (item: number) => {
      if (item === 2) throw new Error('fetch failed');
      return `v${item}`;
    };
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamOrdered([0, 1, 2, 3], boom, { concurrency: 2 })) {
        // drain
      }
    }).rejects.toThrow('fetch failed');
  });

  it('handles an empty input', async () => {
    const seen: unknown[] = [];
    for await (const r of streamOrdered([], async () => 1)) seen.push(r);
    expect(seen).toEqual([]);
  });
});
