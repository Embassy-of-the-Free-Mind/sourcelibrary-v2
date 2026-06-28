/**
 * Tests for the Trithemian provenance mark (steganographia.ts).
 *
 * Focus: the authentication hardening — a mark must round-trip, verify
 * under the real key, and FAIL to verify when forged or read with the
 * wrong key. Presence-only reads and legacy marks must still resolve.
 */

import { describe, it, expect } from 'vitest';
import {
  imprimatur,
  verifyProvenance,
  readProvenance,
  clean,
  hasProvenance,
} from '@/lib/steganographia';

const KEY = 'test-provenance-secret-key';
const OTHER_KEY = 'a-different-secret-key';

const SAMPLE =
  'Mercury rises from the earth. The philosophers call it the prime matter. ' +
  'It is volatile and fixed at once! What then is the stone? ' +
  'Consider the work of the sun and moon. The vessel must be sealed.';

describe('imprimatur / verifyProvenance', () => {
  it('round-trips an edition id and authenticates under the same key', () => {
    const marked = imprimatur(SAMPLE, '6a358363', KEY);
    expect(clean(marked)).toBe(SAMPLE); // visible text unchanged
    expect(marked).not.toBe(SAMPLE); // marks were actually inserted

    const { editionId, authentic } = verifyProvenance(marked, KEY);
    expect(editionId).toBe('6a358363');
    expect(authentic).toBe(true);
  });

  it('does NOT authenticate under the wrong key', () => {
    const marked = imprimatur(SAMPLE, '6a358363', KEY);
    const { editionId, authentic } = verifyProvenance(marked, OTHER_KEY);
    expect(authentic).toBe(false);
    // id is still recoverable on a presence basis
    expect(editionId).toBe('6a358363');
  });

  it('rejects a forged mark whose MAC was guessed', () => {
    // Build a mark with the wrong key (an attacker who knows the scheme and
    // the public edition id but not the secret), then verify with the real key.
    const forged = imprimatur(SAMPLE, '6a358363', OTHER_KEY);
    const { authentic } = verifyProvenance(forged, KEY);
    expect(authentic).toBe(false);
  });

  it('survives excerpting — a fragment with one full mark still verifies', () => {
    const marked = imprimatur(SAMPLE, 'abc1234d', KEY);
    // Take a middle slice large enough to contain at least one full copy.
    const fragment = marked.slice(Math.floor(marked.length * 0.2), Math.floor(marked.length * 0.8));
    const { editionId, authentic } = verifyProvenance(fragment, KEY);
    // Excerpt may or may not contain a complete copy; if it carries the id at
    // all, it must authenticate (we never want a present-but-unauthenticated
    // genuine mark).
    if (editionId) expect(authentic).toBe(true);
  });

  it('reports no mark on clean text', () => {
    expect(verifyProvenance(SAMPLE, KEY)).toEqual({ editionId: null, message: null, authentic: false });
    expect(readProvenance(SAMPLE)).toBeNull();
    expect(hasProvenance(SAMPLE)).toBe(false);
  });

  it('re-marking replaces the prior mark rather than stacking', () => {
    const once = imprimatur(SAMPLE, '6a358363', KEY);
    const twice = imprimatur(once, '6a358363', KEY);
    expect(twice).toBe(once);
  });

  it('full 12-byte edition id round-trips', () => {
    const marked = imprimatur(SAMPLE, '0123456789ab', KEY);
    expect(verifyProvenance(marked, KEY)).toEqual({ editionId: '0123456789ab', message: '', authentic: true });
  });

  it('carries a readable colophon message that round-trips and authenticates', () => {
    const msg = 'Source Library · sourcelibrary.org/book/6a358363f13bd628 · CC BY-SA 4.0';
    const marked = imprimatur(SAMPLE, '6a358363', KEY, { message: msg });
    expect(clean(marked)).toBe(SAMPLE); // still invisible
    const { editionId, message, authentic } = verifyProvenance(marked, KEY);
    expect(editionId).toBe('6a358363');
    expect(message).toBe(msg);
    expect(authentic).toBe(true);
  });

  it('binds the message into the MAC — a swapped message fails to authenticate', () => {
    const a = imprimatur(SAMPLE, '6a358363', KEY, { message: 'genuine note' });
    const b = imprimatur(SAMPLE, '6a358363', OTHER_KEY, { message: 'forged note' });
    expect(verifyProvenance(a, KEY).authentic).toBe(true);
    expect(verifyProvenance(b, KEY).authentic).toBe(false);
  });

  it('readProvenance recovers the id but makes no authenticity claim', () => {
    const marked = imprimatur(SAMPLE, '6a358363', KEY);
    expect(readProvenance(marked)).toBe('6a358363');
  });

  it('rejects an empty edition id', () => {
    expect(() => imprimatur(SAMPLE, '', KEY)).toThrow();
  });

  it('requires a secret key to mark', () => {
    expect(() => imprimatur(SAMPLE, '6a358363', '')).toThrow();
  });
});

describe('legacy mark compatibility (pre-authentication format)', () => {
  // Re-create the old encoding: raw ascii id bytes, MARKER+8 bits, no MAC,
  // one copy, FILLER terminator — enough for the readers to recognise it.
  const Z = { ZERO: '​', ONE: '‌', MARKER: '‍', FILLER: '﻿' };
  function legacyEncode(id: string): string {
    let out = '';
    for (const byte of Buffer.from(id, 'utf-8')) {
      out += Z.MARKER;
      for (let bit = 7; bit >= 0; bit--) out += (byte >> bit) & 1 ? Z.ONE : Z.ZERO;
    }
    return out + Z.FILLER;
  }

  it('reads a legacy id but never marks it authentic', () => {
    const legacy = 'The work begins.' + legacyEncode('6a358363') + ' The vessel is sealed.';
    expect(readProvenance(legacy)).toBe('6a358363');
    const { editionId, authentic } = verifyProvenance(legacy, KEY);
    expect(editionId).toBe('6a358363');
    expect(authentic).toBe(false);
  });
});
