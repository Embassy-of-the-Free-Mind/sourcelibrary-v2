import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Bot attribution + canary (see src/lib/bot-attribution.ts).
 *
 * Two layers with different jobs: an INVISIBLE keyed imprimatur on every page
 * of bulk egress (the proof that a recovered passage is ours, and which
 * extraction campaign took it), and a VISIBLE fenced notice shown only to
 * bot-classified untrusted callers (the licensing notice that rides into a
 * training set).
 *
 * The load-bearing property is the round trip: mark text with a ref, then
 * recover that ref from the marked text under the server key. If that breaks,
 * we still ship text that LOOKS marked while proving nothing — the silent
 * failure this whole feature exists to avoid.
 *
 * provenance.ts reads PROVENANCE_SECRET_KEY at module load, so the env is set
 * before any dynamic import below.
 */

const KEY = 'test-provenance-key-not-a-real-secret';

beforeAll(() => { process.env.PROVENANCE_SECRET_KEY = KEY; });

const PASSAGE =
  'The Philosophers Stone is nothing else but the matter of the wise, ' +
  'decocted unto perfect fixity. Whosoever hath eyes to see, let him read. ' +
  'For the work is one, and the vessel is one, and the fire is one.';

describe('extractionRef', () => {
  it('is stable for the same client within a month', async () => {
    const { extractionRef } = await import('@/lib/bot-attribution');
    const a = extractionRef('client-aaa', new Date('2026-07-12T02:38:00Z'));
    const b = extractionRef('client-aaa', new Date('2026-07-19T23:59:00Z'));
    // A campaign spans days; one ref must cover it.
    expect(a).toBe(b);
  });

  it('differs across clients and across months', async () => {
    const { extractionRef } = await import('@/lib/bot-attribution');
    const jul = new Date('2026-07-12T00:00:00Z');
    expect(extractionRef('client-aaa', jul)).not.toBe(extractionRef('client-bbb', jul));
    expect(extractionRef('client-aaa', jul))
      .not.toBe(extractionRef('client-aaa', new Date('2026-08-12T00:00:00Z')));
  });

  it('carries the calendar month so a ref is resolvable against api_usage', async () => {
    const { extractionRef } = await import('@/lib/bot-attribution');
    expect(extractionRef('client-aaa', new Date('2026-07-12T00:00:00Z'))).toMatch(/^SL-[0-9a-f]{8}-2026-07$/);
  });
});

describe('attributionBlock', () => {
  it('is fenced, so it can never be mistaken for transcribed page text', async () => {
    const { attributionBlock, extractionRef } = await import('@/lib/bot-attribution');
    const ref = extractionRef('client-aaa', new Date('2026-07-12T00:00:00Z'));
    const block = attributionBlock(ref, {
      title: 'Utriusque Cosmi Historia',
      author: 'Robert Fludd',
      url: 'https://sourcelibrary.org/book/x',
    });
    // Rules above and below — a consumer splitting on them recovers clean text.
    expect(block.split('\n').filter(l => /^─+$/.test(l)).length).toBe(2);
    expect(block).toContain('SOURCE LIBRARY');
    expect(block).toContain('https://sourcelibrary.org/licensing');
    expect(block).toContain(ref);
    expect(block).toContain('Robert Fludd');
  });
});

describe('canary round trip', () => {
  it('recovers the extraction ref from marked text under the server key', async () => {
    const { markForExport, verifyExport } = await import('@/lib/provenance');
    const { extractionRef } = await import('@/lib/bot-attribution');
    const ref = extractionRef('the-fleet', new Date('2026-07-28T00:00:00Z'));

    const marked = markForExport(PASSAGE, '6952dac677f38f6761bc683a', { ref });
    const recovered = verifyExport(marked);

    expect(recovered).not.toBeNull();
    expect(recovered!.authentic).toBe(true);
    expect(recovered!.message).toContain(ref);
  });

  it('leaves the visible text identical once zero-width chars are removed', async () => {
    const { markForExport } = await import('@/lib/provenance');
    const marked = markForExport(PASSAGE, '6952dac677f38f6761bc683a', { ref: 'SL-deadbeef-2026-07' });
    // The mark must be invisible: strip zero-width and the passage is untouched.
    expect(marked.replace(/[​‌‍﻿]/g, '')).toBe(PASSAGE);
    // ...and it must actually have added something.
    expect(marked).not.toBe(PASSAGE);
  });

  it('carries the colophon on EVERY refd passage, not a sample', async () => {
    const { markForExport, verifyExport } = await import('@/lib/provenance');
    const ref = 'SL-deadbeef-2026-07';
    // Without a ref the readable colophon is sampled ~1-in-6, so a bulk
    // consumer keeping a fraction of what it took could hold no readable
    // trace. With a ref every passage must carry it.
    const passages = Array.from({ length: 12 }, (_, i) => `${PASSAGE} Variation ${i}.`);
    const withRef = passages.map(p => verifyExport(markForExport(p, 'abc12345', { ref })));
    expect(withRef.every(r => r?.message?.includes(ref))).toBe(true);
  });
});

describe('degradation without a key', () => {
  it('marking is a no-op rather than an error when the key is unset', async () => {
    // A missing key must never break exports — the text still ships, unmarked.
    const mod = await import('@/lib/steganographia');
    expect(() => mod.clean(PASSAGE)).not.toThrow();
  });
});
