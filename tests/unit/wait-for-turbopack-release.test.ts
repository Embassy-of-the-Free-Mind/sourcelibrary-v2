import { describe, expect, it } from 'vitest';
import { waitForTurbopackRelease } from '@/lib/wait-for-turbopack-release';

describe('waitForTurbopackRelease (#7731)', () => {
  it('keeps polling while RSS is over the limit and returns once it falls under', async () => {
    const readings = [5000, 4000, 900];
    let reads = 0;
    const result = await waitForTurbopackRelease({
      limitBytes: 1000,
      pollMs: 1,
      rss: () => readings[Math.min(reads++, readings.length - 1)],
    });
    expect(result).toMatchObject({ released: true, rssBytes: 900 });
    expect(reads).toBe(3);
  });

  it('gives up at the timeout and reports it, so a slow release never fails the build', async () => {
    const result = await waitForTurbopackRelease({ limitBytes: 1000, timeoutMs: 20, pollMs: 1, rss: () => 5000 });
    expect(result).toMatchObject({ released: false, rssBytes: 5000 });
    expect(result.waitedMs).toBeGreaterThanOrEqual(20);
  });

  it('does not wait at all when RSS is already under the limit', async () => {
    const result = await waitForTurbopackRelease({ limitBytes: 1000, pollMs: 60_000, rss: () => 10 });
    expect(result).toMatchObject({ released: true, waitedMs: expect.any(Number) });
    expect(result.waitedMs).toBeLessThan(1000);
  });
});
