import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Per-pool extraction ref (#6950).
 *
 * A residential proxy pool rotates its address per request but keeps one
 * forged user-agent string. Text served to a flagged string carries a ref
 * keyed on that string + month, so a harvested passage found elsewhere names
 * the pool that took it. Readers on any other string get the unchanged,
 * ref-free reader mark.
 *
 * provenance.ts and bot-attribution.ts read PROVENANCE_SECRET_KEY at module
 * load, so the env is set before any dynamic import below.
 */

const KEY = 'test-provenance-key-not-a-real-secret';
beforeAll(() => { process.env.PROVENANCE_SECRET_KEY = KEY; });

vi.mock('@/lib/mongodb', () => ({ getDb: async () => { throw new Error('no db in unit tests'); } }));

const POOL_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const READER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const BOOK = '6952dac677f38f6761bc683a';
const PAGE = { book_id: BOOK, translation: { data: 'The Philosophers Stone is nothing else but the matter of the wise, decocted unto perfect fixity. Whosoever hath eyes to see, let him read. For the work is one, and the vessel is one, and the fire is one.' } };

const req = (ua: string) => new Request('https://sourcelibrary.org/api/pages/x', { headers: { 'user-agent': ua } });

describe('poolRef', () => {
  it("is stable across a pool's rotating addresses within a month, and differs by string and month", async () => {
    const { poolRef } = await import('@/lib/bot-attribution');
    const a = poolRef(POOL_UA, new Date('2026-10-02T00:00:00Z'));
    expect(a).toBe(poolRef(POOL_UA, new Date('2026-10-30T23:00:00Z')));
    expect(a).not.toBe(poolRef(READER_UA, new Date('2026-10-02T00:00:00Z')));
    expect(a).not.toBe(poolRef(POOL_UA, new Date('2026-11-02T00:00:00Z')));
    expect(a).toMatch(/^SLP-[0-9a-f]{8}-2026-10$/);
  });
});

describe('poolRefFor', () => {
  it('returns a ref only for a flagged string', async () => {
    const { poolRefFor, _resetPoolCacheForTests } = await import('@/lib/suspected-pool');
    _resetPoolCacheForTests(new Set([POOL_UA]));
    expect(await poolRefFor(req(POOL_UA))).toMatch(/^SLP-/);
    expect(await poolRefFor(req(READER_UA))).toBeUndefined();
  });

  it('fails open to "not a pool" when the store is unreachable', async () => {
    const { poolRefFor, _resetPoolCacheForTests } = await import('@/lib/suspected-pool');
    _resetPoolCacheForTests();
    expect(await poolRefFor(req(POOL_UA))).toBeUndefined();
  });
});

describe('reader mark with a pool ref', () => {
  it('round-trips: the ref decodes from the marked translation under the key', async () => {
    const { markPageForReader, verifyExport } = await import('@/lib/provenance');
    const { poolRef } = await import('@/lib/bot-attribution');
    const ref = poolRef(POOL_UA, new Date('2026-10-18T00:00:00Z'));
    const marked = markPageForReader(PAGE, undefined, { ref });
    const got = verifyExport(marked.translation.data as string);
    expect(got?.authentic).toBe(true);
    expect(got?.message).toContain(ref);
    // Invisible: the visible text is unchanged.
    expect((marked.translation.data as string).replace(/[​-‏⁠-⁤﻿]/g, '')).toBe(PAGE.translation.data);
  });

  it('without a ref is byte-identical to the existing deterministic reader mark', async () => {
    const { markPageForReader } = await import('@/lib/provenance');
    expect(markPageForReader(PAGE, undefined, { ref: undefined })).toEqual(markPageForReader(PAGE));
  });
});
